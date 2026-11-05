// ==========================================================================
// NOTIFICACIONES (la campana del menú)
//
// Cada aviso se guarda en la tabla Notificaciones y se empuja al instante a
// las páginas abiertas del usuario (evento "notificacion:nueva", ver tiempoReal.js).
// Si el aviso trae "correo", también se manda por correo (si está configurado).
//
//   await notificaciones.enviar([{
//       usuarioId: 12,
//       tipo: 'PujaSuperada',
//       titulo: 'Te superaron en una subasta',
//       mensaje: 'Alguien ofreció C$540 por «Cuero café».',
//       enlace: 'mercado.html#tab-auctions',
//       referenciaId: 8,            // la subasta o el trato
//       agrupar: true,              // si ya hay uno igual SIN LEER, se actualiza en vez de crear otro
//       correo: { asunto, titulo, parrafos }   // opcional
//   }]);
//
// enviar() nunca lanza errores: un aviso que falla queda en el log, pero la
// acción principal (la puja, el cierre de la subasta...) ya quedó guardada.
// Se llama DESPUÉS de confirmar la transacción de esa acción.
// ==========================================================================

const TIPOS = {
    PujaSuperada: 'Te superaron en una puja',
    PujaRecibida: 'Nueva puja en tu subasta',
    SubastaGanada: 'Ganaste una subasta',
    SubastaTerminada: 'Una subasta terminó',
    SubastaCancelada: 'Una subasta fue cancelada',
    TratoActualizado: 'Un trato cambió de estado',
    CalificacionRecibida: 'Recibiste una calificación',
    AlertaBusqueda: 'Se publicó algo que buscabas',
    FavoritoRebajado: 'Un favorito bajó de precio'
};

const recortar = (texto, largo) => String(texto || '').slice(0, largo);

// Fila de la base → lo que recibe el navegador
const aJson = (f) => ({
    id: f.NotificacionID,
    tipo: f.Tipo,
    titulo: f.Titulo,
    mensaje: f.Mensaje,
    enlace: f.Enlace,
    referenciaId: f.ReferenciaID,
    leida: !!f.EsLeida,
    fecha: f.FechaCreacion
});

function crearServicioNotificaciones({ db, tiempoReal, correo = null, urlBase = null }) {

    // Guarda un aviso (o actualiza el que ya estaba sin leer) y devuelve { fila, nueva }
    async function guardar(a) {
        const titulo = recortar(a.titulo || TIPOS[a.tipo] || 'Aviso', 120);
        const mensaje = recortar(a.mensaje, 300);
        if (a.agrupar && a.referenciaId) {
            const [r] = await db.query(
                `UPDATE Notificaciones SET Titulo = ?, Mensaje = ?, Enlace = ?, FechaCreacion = NOW()
                 WHERE UsuarioID = ? AND Tipo = ? AND ReferenciaID = ? AND EsLeida = 0
                 ORDER BY NotificacionID DESC LIMIT 1`,
                [titulo, mensaje, a.enlace || null, a.usuarioId, a.tipo, a.referenciaId]
            );
            if (r.affectedRows > 0) {
                const [[fila]] = await db.query(
                    `SELECT * FROM Notificaciones WHERE UsuarioID = ? AND Tipo = ? AND ReferenciaID = ? AND EsLeida = 0
                     ORDER BY NotificacionID DESC LIMIT 1`, [a.usuarioId, a.tipo, a.referenciaId]);
                return { fila, nueva: false };
            }
        }
        const [r] = await db.query(
            'INSERT INTO Notificaciones (UsuarioID, Tipo, Titulo, Mensaje, Enlace, ReferenciaID) VALUES (?, ?, ?, ?, ?, ?)',
            [a.usuarioId, a.tipo, titulo, mensaje, a.enlace || null, a.referenciaId || null]
        );
        const [[fila]] = await db.query('SELECT * FROM Notificaciones WHERE NotificacionID = ?', [r.insertId]);
        return { fila, nueva: true };
    }

    async function enviar(avisos) {
        const lista = (avisos || []).filter(a => a && a.usuarioId && a.tipo);
        const conCorreo = [];
        for (const aviso of lista) {
            try {
                const { fila, nueva } = await guardar(aviso);
                tiempoReal.aUsuario(aviso.usuarioId, 'notificacion:nueva', aJson(fila));
                // Si se agrupó con uno que ya estaba sin leer, no se repite el correo
                if (aviso.correo && nueva) conCorreo.push(aviso);
            } catch (err) {
                console.error(`⚠️ No se pudo guardar la notificación ${aviso.tipo} para el usuario ${aviso.usuarioId}:`, err.message);
            }
        }
        if (conCorreo.length > 0) {
            avisarPorCorreo(conCorreo).catch(err => console.error('⚠️ Notificación por correo no enviada:', err.message));
        }
    }

    async function avisarPorCorreo(avisos) {
        if (!correo || !correo.configurado) return;
        const [usuarios] = await db.query(
            'SELECT UsuarioID, CorreoElectronico FROM Usuarios WHERE UsuarioID IN (?)',
            [[...new Set(avisos.map(a => a.usuarioId))]]
        );
        const porId = new Map(usuarios.map(u => [u.UsuarioID, u.CorreoElectronico]));
        const envios = avisos.filter(a => porId.has(a.usuarioId)).map(a => correo.enviarAviso(porId.get(a.usuarioId), {
            asunto: a.correo.asunto || a.titulo,
            titulo: a.correo.titulo || a.titulo,
            parrafos: a.correo.parrafos || [a.mensaje],
            boton: urlBase && a.enlace ? { texto: a.correo.textoBoton || 'Abrir EntreLazados', enlace: `${urlBase}/${a.enlace}` } : null
        }));
        for (const r of await Promise.allSettled(envios)) {
            if (r.status === 'rejected') console.error('⚠️ Notificación por correo no enviada:', r.reason.message);
        }
    }

    // ---------------------------------------------------------- CONSULTAS (rutas/notificaciones.js)
    async function listar(usuarioId, limite = 30) {
        const [filas] = await db.query(
            'SELECT * FROM Notificaciones WHERE UsuarioID = ? ORDER BY FechaCreacion DESC, NotificacionID DESC LIMIT ?',
            [usuarioId, limite]
        );
        const [[{ total }]] = await db.query(
            'SELECT COUNT(*) AS total FROM Notificaciones WHERE UsuarioID = ? AND EsLeida = 0', [usuarioId]);
        return { noLeidas: Number(total), notificaciones: filas.map(aJson) };
    }

    // Devuelve true si la marcó (false si no existe o es de otro usuario)
    async function marcarLeida(usuarioId, notificacionId) {
        const [r] = await db.query(
            'UPDATE Notificaciones SET EsLeida = 1 WHERE NotificacionID = ? AND UsuarioID = ?',
            [notificacionId, usuarioId]
        );
        return r.affectedRows > 0;
    }

    async function marcarTodasLeidas(usuarioId) {
        const [r] = await db.query('UPDATE Notificaciones SET EsLeida = 1 WHERE UsuarioID = ? AND EsLeida = 0', [usuarioId]);
        return r.affectedRows;
    }

    return { enviar, listar, marcarLeida, marcarTodasLeidas };
}

// Versión que no hace nada (pruebas sin base de datos)
const notificacionesNulas = {
    enviar: async () => { },
    listar: async () => ({ noLeidas: 0, notificaciones: [] }),
    marcarLeida: async () => false,
    marcarTodasLeidas: async () => 0
};

module.exports = { crearServicioNotificaciones, notificacionesNulas, TIPOS };
