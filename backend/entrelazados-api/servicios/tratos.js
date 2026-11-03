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
// (queda como registro de quién hizo qué), una notificación en la campana y
// un correo si está configurado.
//
// CALIFICACIONES: cuando el trato está Completado, cada parte califica a la
// otra una sola vez (1 a 5 estrellas y un comentario opcional). El promedio
// se muestra en el Mercado junto a cada proveedor y en el dashboard.
// ==========================================================================
const { nombreLote } = require('./subastas');
const { ErrorHttp, redondearCalificacion } = require('../utilidades');
const { enTransaccion } = require('../db');
const { tiempoRealNulo } = require('./tiempoReal');
const { notificacionesNulas } = require('./notificaciones');

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
const LARGO_MAXIMO_COMENTARIO = 300;

// "Subasta ganada: Lote Subasta: Cuero café" → "Cuero café"
const loteDelTrato = (descripcion) => nombreLote(String(descripcion || '').replace(/^Subasta ganada:\s*/i, ''));

// Error con código HTTP, para que la ruta responda el mensaje tal cual
const fallo = (status, message) => new ErrorHttp(status, message);

function textoDelChat(estado, lote, motivo) {
    if (estado === 'EnProceso') {
        return `🚚 [Aviso automático de EntreLazados] Marqué el trato «${lote}» como EN PROCESO: ya acordamos el pago y la entrega.`;
    }
    if (estado === 'Completado') {
        return `✅ [Aviso automático de EntreLazados] Marqué el trato «${lote}» como COMPLETADO. ¡Gracias por cerrar el trato en EntreLazados!`;
    }
    return `❌ [Aviso automático de EntreLazados] Cancelé el trato «${lote}».` + (motivo ? ` Motivo: ${motivo}` : '');
}

function crearServicioTratos({ db, correo, urlBase, tiempoReal = tiempoRealNulo, notificaciones = notificacionesNulas }) {

    // Cambia el estado de un trato en el que participa usuarioId.
    // Lanza un ErrorHttp (400, 404 o 409) si no se puede.
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

        const { trato, contraparteId } = await enTransaccion(db, async (conn) => {
            // FOR UPDATE: si las dos partes pulsan a la vez, la segunda ve el estado ya cambiado
            const [[trato]] = await conn.query(
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

            const contraparteId = trato.ProveedorID === usuarioId ? trato.EmprendedorID : trato.ProveedorID;
            await conn.query(
                'INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto) VALUES (?, ?, ?)',
                [usuarioId, contraparteId, textoDelChat(estado, loteDelTrato(trato.DescripcionResumen), motivoLimpio)]
            );
            return { trato, contraparteId };
        });

        // El correo va después de guardar y sin bloquear: si falla, el cambio igual queda hecho
        avisarPorCorreo({ trato, usuarioId, contraparteId, estado, motivo: motivoLimpio })
            .catch(err => console.error('⚠️ Aviso de trato no enviado:', err.message));
        tiempoReal.aUsuario([contraparteId, usuarioId], 'chat:mensaje', { remitenteId: usuarioId, destinatarioId: contraparteId });
        const lote = loteDelTrato(trato.DescripcionResumen);
        await notificaciones.enviar([{
            usuarioId: contraparteId,
            tipo: 'TratoActualizado',
            referenciaId: tratoId,
            titulo: `Trato «${lote}»: ${ETIQUETAS[estado]}`,
            mensaje: {
                EnProceso: 'La otra parte marcó el trato como en proceso: ya acordaron el pago y la entrega.',
                Completado: 'La otra parte marcó el trato como completado. Ya puedes calificarla.',
                Cancelado: 'La otra parte canceló el trato.' + (motivoLimpio ? ` Motivo: ${motivoLimpio}` : '')
            }[estado],
            enlace: 'dashboard.html'
        }]);

        return {
            tratoId,
            estadoAnterior: trato.EstadoTrato,
            estado,
            contraparteId
        };
    }

    async function avisarPorCorreo({ trato, usuarioId, contraparteId, estado, motivo }) {
        if (!correo || !correo.configurado) return;
        const [usuarios] = await db.query(
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

    // Califica a la otra parte de un trato completado. Lanza un ErrorHttp (400, 404 o 409).
    async function calificar({ tratoId, usuarioId, puntuacion, comentario }) {
        const estrellas = Number(puntuacion);
        if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) {
            throw fallo(400, 'La calificación debe ser de 1 a 5 estrellas.');
        }
        if (!Number.isInteger(tratoId) || tratoId <= 0) {
            throw fallo(404, 'Ese trato no existe o no participas en él.');
        }
        const comentarioLimpio = typeof comentario === 'string' ? comentario.trim().slice(0, LARGO_MAXIMO_COMENTARIO) : '';

        const resultado = await enTransaccion(db, async (conn) => {
            const [[trato]] = await conn.query(
                `SELECT TratoID, ProveedorID, EmprendedorID, DescripcionResumen, EstadoTrato
                 FROM TratosCerrados
                 WHERE TratoID = ? AND (ProveedorID = ? OR EmprendedorID = ?)
                 FOR UPDATE`,
                [tratoId, usuarioId, usuarioId]
            );
            if (!trato) throw fallo(404, 'Ese trato no existe o no participas en él.');
            if (trato.EstadoTrato !== 'Completado') {
                throw fallo(409, 'Solo puedes calificar un trato completado.');
            }
            const calificadoId = trato.ProveedorID === usuarioId ? trato.EmprendedorID : trato.ProveedorID;
            try {
                await conn.query(
                    'INSERT INTO Calificaciones (TratoID, AutorID, CalificadoID, Puntuacion, Comentario) VALUES (?, ?, ?, ?, ?)',
                    [tratoId, usuarioId, calificadoId, estrellas, comentarioLimpio || null]
                );
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') throw fallo(409, 'Ya calificaste este trato.');
                throw err;
            }
            const lote = loteDelTrato(trato.DescripcionResumen);
            await conn.query(
                'INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto) VALUES (?, ?, ?)',
                [usuarioId, calificadoId,
                    `⭐ [Aviso automático de EntreLazados] Califiqué el trato «${lote}» con ${estrellas} de 5 estrellas.` +
                    (comentarioLimpio ? ` Comentario: ${comentarioLimpio}` : '')]
            );
            return { tratoId, puntuacion: estrellas, calificadoId, lote };
        });

        const { lote, ...respuesta } = resultado;
        tiempoReal.aUsuario([respuesta.calificadoId, usuarioId], 'chat:mensaje', { remitenteId: usuarioId, destinatarioId: respuesta.calificadoId });
        await notificaciones.enviar([{
            usuarioId: respuesta.calificadoId,
            tipo: 'CalificacionRecibida',
            referenciaId: tratoId,
            titulo: `Te calificaron con ${'★'.repeat(estrellas)}${'☆'.repeat(5 - estrellas)}`,
            mensaje: `Por el trato «${lote}».` + (comentarioLimpio ? ` "${comentarioLimpio}"` : ''),
            enlace: 'perfil.html'
        }]);
        return respuesta;
    }

    // Promedio, total y las últimas calificaciones (con comentario) que recibió un usuario
    async function reputacion(usuarioId) {
        const [[resumen]] = await db.query(
            'SELECT COUNT(*) AS total, AVG(Puntuacion) AS promedio FROM Calificaciones WHERE CalificadoID = ?',
            [usuarioId]
        );
        const [ultimas] = await db.query(
            `SELECT c.Puntuacion AS puntuacion, c.Comentario AS comentario, c.FechaCalificacion AS fecha,
                    COALESCE(p.NombreRazonSocial, 'Usuario') AS autor
             FROM Calificaciones c LEFT JOIN PerfilesUsuarios p ON p.UsuarioID = c.AutorID
             WHERE c.CalificadoID = ?
             ORDER BY c.FechaCalificacion DESC, c.CalificacionID DESC
             LIMIT 5`, [usuarioId]
        );
        const total = Number(resumen.total);
        return {
            usuarioId,
            total,
            promedio: total ? redondearCalificacion(resumen.promedio) : null,
            ultimas
        };
    }

    return { cambiarEstado, calificar, reputacion };
}

module.exports = { crearServicioTratos, ESTADOS_ORIGEN, loteDelTrato };
