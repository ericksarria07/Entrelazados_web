// ==========================================================================
// SEGUIMIENTO DE TRATOS (subastas ganadas)
//
// Cuando una subasta cierra con ganador, el trato nace 'Pendiente' (ver
// subastas.js). Desde el dashboard, el proveedor o el comprador lo avanzan:
//
//   Pendiente ──► EnProceso ──► Completado
//       │             │
//       └─────────────┴──► Cancelado
//
// (también se puede pasar de Pendiente a Completado si se entrega enseguida).
// Completado y Cancelado son finales. Cualquiera de las dos partes puede
// cambiar el estado; la otra parte recibe un mensaje automático en el chat
// (queda como registro de quién hizo qué) y un correo si está configurado.
// ==========================================================================
const { nombreLote } = require('./subastas');

// A cada estado nuevo solo se puede llegar desde estos estados
const ESTADOS_ORIGEN = {
    EnProceso: ['Pendiente'],
    Completado: ['Pendiente', 'EnProceso'],
    Cancelado: ['Pendiente', 'EnProceso']
};

const ETIQUETAS = {
    Pendiente: 'pendiente',
    EnProceso: 'en proceso',
    Completado: 'completado',
    Cancelado: 'cancelado'
};

const LARGO_MAXIMO_MOTIVO = 200;

// "Subasta ganada: Lote Subasta: Cuero café" → "Cuero café"
const loteDelTrato = (descripcion) => nombreLote(String(descripcion || '').replace(/^Subasta ganada:\s*/i, ''));

// Error con código HTTP, para que la ruta responda el mensaje tal cual
const fallo = (status, message) => Object.assign(new Error(message), { status });

function textoDelChat(estado, lote, motivo) {
    if (estado === 'EnProceso') {
        return `🚚 [Aviso automático de EntreLazados] Marqué el trato «${lote}» como EN PROCESO: ya acordamos el pago y la entrega.`;
    }
    if (estado === 'Completado') {
        return `✅ [Aviso automático de EntreLazados] Marqué el trato «${lote}» como COMPLETADO. ¡Gracias por cerrar el trato en EntreLazados!`;
    }
    return `❌ [Aviso automático de EntreLazados] Cancelé el trato «${lote}».` + (motivo ? ` Motivo: ${motivo}` : '');
}

function crearServicioTratos({ db, correo, urlBase }) {

    // Cambia el estado de un trato en el que participa usuarioId.
    // Lanza un error con .status (400, 404 o 409) si no se puede.
    async function cambiarEstado({ tratoId, usuarioId, estado, motivo }) {
        if (!ESTADOS_ORIGEN[estado]) {
            throw fallo(400, 'Estado no válido. Usa EnProceso, Completado o Cancelado.');
        }
        if (!Number.isInteger(tratoId) || tratoId <= 0) {
            throw fallo(404, 'Ese trato no existe o no participas en él.');
        }
        const motivoLimpio = estado === 'Cancelado' && typeof motivo === 'string'
            ? motivo.trim().slice(0, LARGO_MAXIMO_MOTIVO)
            : '';

        const conn = await db.promise().getConnection();
        let trato, contraparteId;
        try {
            await conn.beginTransaction();
            // FOR UPDATE: si las dos partes pulsan a la vez, la segunda ve el estado ya cambiado
            [[trato]] = await conn.query(
                `SELECT TratoID, ProveedorID, EmprendedorID, DescripcionResumen, MontoTotal, EstadoTrato
                 FROM TratosCerrados
                 WHERE TratoID = ? AND (ProveedorID = ? OR EmprendedorID = ?)
                 FOR UPDATE`,
                [tratoId, usuarioId, usuarioId]
            );
            // Mismo mensaje si no existe o si es de otros: no se revela qué tratos existen
            if (!trato) throw fallo(404, 'Ese trato no existe o no participas en él.');
            if (trato.EstadoTrato === estado) throw fallo(409, `El trato ya está ${ETIQUETAS[estado]}.`);
            if (!ESTADOS_ORIGEN[estado].includes(trato.EstadoTrato)) {
                throw fallo(409, `Este trato ya está ${ETIQUETAS[trato.EstadoTrato] || trato.EstadoTrato} y no se puede cambiar.`);
            }

            await conn.query('UPDATE TratosCerrados SET EstadoTrato = ? WHERE TratoID = ?', [estado, tratoId]);

            contraparteId = trato.ProveedorID === usuarioId ? trato.EmprendedorID : trato.ProveedorID;
            await conn.query(
                'INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto) VALUES (?, ?, ?)',
                [usuarioId, contraparteId, textoDelChat(estado, loteDelTrato(trato.DescripcionResumen), motivoLimpio)]
            );
            await conn.commit();
        } catch (err) {
            await conn.rollback().catch(() => { });
            throw err;
        } finally {
            conn.release();
        }

        // El correo va después de guardar y sin bloquear: si falla, el cambio igual queda hecho
        avisarPorCorreo({ trato, usuarioId, contraparteId, estado, motivo: motivoLimpio })
            .catch(err => console.error('⚠️ Aviso de trato no enviado:', err.message));

        return {
            tratoId,
            estadoAnterior: trato.EstadoTrato,
            estado,
            contraparteId
        };
    }

    async function avisarPorCorreo({ trato, usuarioId, contraparteId, estado, motivo }) {
        if (!correo || !correo.configurado) return;
        const [usuarios] = await db.promise().query(
            `SELECT u.UsuarioID, u.CorreoElectronico, COALESCE(p.NombreRazonSocial, '') AS Nombre
             FROM Usuarios u LEFT JOIN PerfilesUsuarios p ON p.UsuarioID = u.UsuarioID
             WHERE u.UsuarioID IN (?, ?)`, [usuarioId, contraparteId]
        );
        const quien = usuarios.find(u => u.UsuarioID === usuarioId);
        const destino = usuarios.find(u => u.UsuarioID === contraparteId);
        if (!destino) return;

        const lote = loteDelTrato(trato.DescripcionResumen);
        const nombre = (quien && quien.Nombre) || (trato.ProveedorID === usuarioId ? 'El proveedor' : 'El comprador');
        const parrafos = {
            EnProceso: [`${nombre} marcó el trato «${lote}» como en proceso: ya acordaron el pago y la entrega.`],
            Completado: [`${nombre} marcó el trato «${lote}» como completado.`, 'Si todavía falta algo por entregar o pagar, escríbele por el chat.'],
            Cancelado: [`${nombre} canceló el trato «${lote}».`, ...(motivo ? [`Motivo: ${motivo}`] : []), 'Si no estabas de acuerdo, escríbele por el chat de EntreLazados.']
        }[estado];

        await correo.enviarAviso(destino.CorreoElectronico, {
            asunto: `Trato ${ETIQUETAS[estado]}: ${lote}`,
            titulo: `Trato ${ETIQUETAS[estado]}`,
            parrafos,
            boton: urlBase ? { texto: 'Ver mis tratos', enlace: `${urlBase}/dashboard.html` } : null
        });
    }

    return { cambiarEstado };
}

module.exports = { crearServicioTratos, ESTADOS_ORIGEN, loteDelTrato };
