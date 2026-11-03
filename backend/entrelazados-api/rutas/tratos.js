// ==========================================================================
// TRATOS (subastas ganadas o vendidas). Todas piden sesión. Se monta en /api/tratos
//   GET  /                   mis tratos
//   PUT  /:id/estado         { estado: 'EnProceso' | 'Completado' | 'Cancelado', motivo? }
//   POST /:id/calificacion   { puntuacion: 1..5, comentario? }
// Las reglas (quién puede, a qué estado se puede pasar) están en servicios/tratos.js.
// ==========================================================================
const express = require('express');

const MENSAJES_ESTADO = {
    EnProceso: 'Trato marcado como en proceso.',
    Completado: '¡Trato completado!',
    Cancelado: 'Trato cancelado.'
};

function crearRutasTratos({ db, tratos, verificarToken }) {
    const router = express.Router();
    router.use(verificarToken);

    // Subastas que gané (emprendedor) o que vendí (proveedor).
    // Primero los que siguen abiertos (pendiente / en proceso), luego los más recientes.
    router.get('/', async (req, res) => {
        const [filas] = await db.query(`
            SELECT t.TratoID AS id, t.TipoOrigen AS origen, t.OrigenID AS origenId,
                   t.DescripcionResumen AS descripcion, t.MontoTotal AS monto,
                   t.EstadoTrato AS estado, t.FechaCierre AS fecha,
                   (t.ProveedorID = ?) AS soyProveedor,
                   IF(t.ProveedorID = ?, t.EmprendedorID, t.ProveedorID) AS contraparteId,
                   COALESCE(p.NombreRazonSocial, 'Usuario') AS contraparte,
                   (SELECT c.Puntuacion FROM Calificaciones c WHERE c.TratoID = t.TratoID AND c.AutorID = ?) AS miCalificacion,
                   (SELECT c.Puntuacion FROM Calificaciones c WHERE c.TratoID = t.TratoID AND c.AutorID <> ?) AS suCalificacion
            FROM TratosCerrados t
            LEFT JOIN PerfilesUsuarios p ON p.UsuarioID = IF(t.ProveedorID = ?, t.EmprendedorID, t.ProveedorID)
            WHERE t.ProveedorID = ? OR t.EmprendedorID = ?
            ORDER BY (t.EstadoTrato IN ('Pendiente', 'EnProceso')) DESC, t.FechaCierre DESC, t.TratoID DESC
            LIMIT 50
        `, Array(7).fill(req.usuario.id));
        res.json(filas.map(t => ({ ...t, monto: Number(t.monto), soyProveedor: !!t.soyProveedor })));
    });

    router.put('/:id/estado', async (req, res) => {
        const resultado = await tratos.cambiarEstado({
            tratoId: Number(req.params.id),
            usuarioId: req.usuario.id,
            estado: req.body.estado,
            motivo: req.body.motivo
        });
        res.json({ message: `${MENSAJES_ESTADO[resultado.estado]} Le avisamos a la otra parte por el chat.`, ...resultado });
    });

    router.post('/:id/calificacion', async (req, res) => {
        const resultado = await tratos.calificar({
            tratoId: Number(req.params.id),
            usuarioId: req.usuario.id,
            puntuacion: req.body.puntuacion,
            comentario: req.body.comentario
        });
        res.status(201).json({ message: '¡Gracias por calificar! Le avisamos a la otra parte por el chat.', ...resultado });
    });

    return router;
}

module.exports = crearRutasTratos;
