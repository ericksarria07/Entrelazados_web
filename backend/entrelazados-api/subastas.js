// ==========================================================================
// CIERRE AUTOMÁTICO DE SUBASTAS
//
// Cada minuto (INTERVALO_CIERRE_SUBASTAS_SEG en el .env) se buscan las
// subastas 'Activa' cuya FechaFin ya pasó y, para cada una:
//   1. se marca como 'Finalizada';
//   2. si tuvo pujas, gana la más alta: se registra en TratosCerrados
//      (estado 'Pendiente', porque falta coordinar pago y entrega) y se abre
//      el chat entre proveedor y ganador con un mensaje automático;
//   3. se avisa por correo al proveedor y al ganador (si el correo está configurado).
//
// Todo lo de una subasta va en una transacción con "SELECT ... FOR UPDATE":
// si el proceso se ejecuta dos veces a la vez, la segunda vez la subasta ya
// no está 'Activa' y no se repite nada. Una puja que llega en el último
// segundo tampoco puede colarse: /api/pujas exige FechaFin > NOW().
// ==========================================================================

// Las subastas se guardan como "Lote Subasta: <material>"; en avisos se muestra solo el material
const nombreLote = (titulo) => String(titulo || '').replace(/^Lote Subasta:\s*/i, '') || 'tu lote';

const formatoCordobas = (monto) => 'C$' + Number(monto).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function crearCierreSubastas({ db, correo, urlBase }) {
    let enCurso = false;

    // Cierra las subastas vencidas. Devuelve la lista de las que cerró.
    async function cerrarVencidas() {
        if (enCurso) return [];   // evita que dos ejecuciones se crucen en el mismo proceso
        enCurso = true;
        const cerradas = [];
        const conn = await db.promise().getConnection();
        try {
            const [vencidas] = await conn.query(
                "SELECT SubastaID FROM Subastas WHERE Estado = 'Activa' AND FechaFin <= NOW() ORDER BY FechaFin LIMIT 200"
            );

            for (const { SubastaID } of vencidas) {
                try {
                    await conn.beginTransaction();
                    const [[subasta]] = await conn.query(
                        "SELECT SubastaID, ProveedorID, TituloLote, PrecioBase FROM Subastas WHERE SubastaID = ? AND Estado = 'Activa' FOR UPDATE",
                        [SubastaID]
                    );
                    if (!subasta) { await conn.rollback(); continue; }

                    // Gana la puja más alta; si hubiera empate, la que llegó primero
                    const [[ganadora]] = await conn.query(
                        'SELECT EmprendedorID, MontoPuja FROM Pujas WHERE SubastaID = ? ORDER BY MontoPuja DESC, FechaPuja ASC, PujaID ASC LIMIT 1',
                        [SubastaID]
                    );

                    await conn.query("UPDATE Subastas SET Estado = 'Finalizada' WHERE SubastaID = ?", [SubastaID]);

                    let tratoId = null;
                    if (ganadora) {
                        const [trato] = await conn.query(
                            `INSERT INTO TratosCerrados (ProveedorID, EmprendedorID, TipoOrigen, OrigenID, DescripcionResumen, MontoTotal, EstadoTrato)
                             VALUES (?, ?, 'Subasta', ?, ?, ?, 'Pendiente')`,
                            [subasta.ProveedorID, ganadora.EmprendedorID, SubastaID,
                                `Subasta ganada: ${subasta.TituloLote}`.slice(0, 255), ganadora.MontoPuja]
                        );
                        tratoId = trato.insertId;

                        await conn.query(
                            'INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto) VALUES (?, ?, ?)',
                            [subasta.ProveedorID, ganadora.EmprendedorID,
                                `🎉 [Mensaje automático de EntreLazados] ¡Felicidades! Ganaste la subasta «${nombreLote(subasta.TituloLote)}» ` +
                                `con una puja de ${formatoCordobas(ganadora.MontoPuja)}. Escríbeme por aquí para coordinar el pago y la entrega.`]
                        );
                    }

                    await conn.commit();
                    cerradas.push({
                        subastaId: SubastaID,
                        lote: nombreLote(subasta.TituloLote),
                        proveedorId: subasta.ProveedorID,
                        ganadorId: ganadora ? ganadora.EmprendedorID : null,
                        monto: ganadora ? Number(ganadora.MontoPuja) : null,
                        tratoId
                    });
                } catch (err) {
                    await conn.rollback().catch(() => { });
                    console.error(`❌ No se pudo cerrar la subasta ${SubastaID}:`, err.message);
                }
            }
        } finally {
            conn.release();
            enCurso = false;
        }

        if (cerradas.length > 0) {
            const conGanador = cerradas.filter(c => c.ganadorId).length;
            console.log(`🔨 Subastas cerradas: ${cerradas.length} (${conGanador} con ganador, ${cerradas.length - conGanador} sin pujas)`);
            avisarPorCorreo(cerradas).catch(err => console.error('⚠️ Error al avisar el cierre de subastas:', err.message));
        }
        return cerradas;
    }

    // Los correos se mandan después de confirmar en la base de datos y sin
    // bloquear: si fallan, la subasta igual queda cerrada.
    async function avisarPorCorreo(cerradas) {
        if (!correo.configurado) return;
        const ids = [...new Set(cerradas.flatMap(c => [c.proveedorId, c.ganadorId]).filter(Boolean))];
        const [usuarios] = await db.promise().query(
            `SELECT u.UsuarioID, u.CorreoElectronico, COALESCE(p.NombreRazonSocial, '') AS Nombre
             FROM Usuarios u LEFT JOIN PerfilesUsuarios p ON p.UsuarioID = u.UsuarioID
             WHERE u.UsuarioID IN (?)`, [ids]
        );
        const porId = new Map(usuarios.map(u => [u.UsuarioID, u]));
        const enlaceChat = urlBase ? { texto: 'Abrir el chat', enlace: `${urlBase}/chat.html` } : null;
        const enlaceDashboard = urlBase ? { texto: 'Ver mi dashboard', enlace: `${urlBase}/dashboard.html` } : null;

        for (const c of cerradas) {
            const proveedor = porId.get(c.proveedorId);
            const ganador = c.ganadorId ? porId.get(c.ganadorId) : null;
            const envios = [];

            if (proveedor && ganador) {
                envios.push(correo.enviarAviso(proveedor.CorreoElectronico, {
                    asunto: `Tu subasta terminó: ${c.lote}`,
                    titulo: '¡Tu subasta tiene ganador!',
                    parrafos: [
                        `La subasta «${c.lote}» terminó con una puja ganadora de ${formatoCordobas(c.monto)} de ${ganador.Nombre || 'un emprendedor'}.`,
                        'Le enviamos un mensaje en tu nombre para abrir la conversación. Coordina el pago y la entrega desde el chat de EntreLazados.'
                    ],
                    boton: enlaceChat
                }));
                envios.push(correo.enviarAviso(ganador.CorreoElectronico, {
                    asunto: `Ganaste la subasta: ${c.lote}`,
                    titulo: '¡Ganaste la subasta! 🎉',
                    parrafos: [
                        `Tu puja de ${formatoCordobas(c.monto)} fue la más alta en «${c.lote}».`,
                        `${proveedor.Nombre || 'El proveedor'} ya te escribió por el chat de EntreLazados para coordinar el pago y la entrega.`
                    ],
                    boton: enlaceChat
                }));
            } else if (proveedor) {
                envios.push(correo.enviarAviso(proveedor.CorreoElectronico, {
                    asunto: `Tu subasta terminó sin pujas: ${c.lote}`,
                    titulo: 'Tu subasta terminó',
                    parrafos: [
                        `La subasta «${c.lote}» llegó a su fecha de cierre sin recibir pujas.`,
                        'Puedes volver a publicar el material desde el Mercado para abrir una nueva subasta.'
                    ],
                    boton: enlaceDashboard
                }));
            }

            for (const resultado of await Promise.allSettled(envios)) {
                if (resultado.status === 'rejected') console.error('⚠️ Aviso de subasta no enviado:', resultado.reason.message);
            }
        }
    }

    // Arranca la revisión periódica
    function iniciar(intervaloSegundos) {
        const ejecutar = () => cerrarVencidas().catch(err => console.error('❌ Error al cerrar subastas vencidas:', err.message));
        setTimeout(ejecutar, 5000);   // una vez al arrancar (por si el servidor estuvo apagado)
        setInterval(ejecutar, intervaloSegundos * 1000);
        console.log(`✅ Cierre automático de subastas activo (cada ${intervaloSegundos} s).`);
    }

    return { cerrarVencidas, iniciar };
}

module.exports = { crearCierreSubastas };
