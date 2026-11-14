// ==========================================================================
// TRATOS (subastas ganadas o vendidas). Todas piden sesión. Se monta en /api/tratos
//   GET  /                   mis tratos (?origen=Subasta, ?pagina=&porPagina= para paginar)
//   PUT  /:id/estado         { estado: 'EnProceso' | 'Completado' | 'Cancelado', motivo? }
//   POST /:id/calificacion   { puntuacion: 1..5, comentario? }
//   GET  /:id/comprobante    datos para imprimir el comprobante (las dos partes o el admin)
// Las reglas (quién puede, a qué estado se puede pasar) están en servicios/tratos.js.
// ==========================================================================
const express = require('express');
const { leerPaginacion, respuestaPaginada } = require('../utilidades');

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
    // Sin ?pagina responde la lista (hasta 50) como antes; con ?pagina=N responde
    // { datos, total, pagina, porPagina, paginas }. ?origen=Subasta deja solo los de subastas.
    router.get('/', async (req, res) => {
        const pag = leerPaginacion(req.query, 6, 20);
        const yo = req.usuario.id;
        const soloSubastas = req.query.origen === 'Subasta';
        const where = `WHERE (t.ProveedorID = ? OR t.EmprendedorID = ?)${soloSubastas ? " AND t.TipoOrigen = 'Subasta'" : ''}`;
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
            ${where}
            ORDER BY (t.EstadoTrato IN ('Pendiente', 'EnProceso')) DESC, t.FechaCierre DESC, t.TratoID DESC
            LIMIT ? OFFSET ?
        `, [...Array(7).fill(yo), pag ? pag.porPagina : 50, pag ? pag.offset : 0]);
        const lista = filas.map(t => ({ ...t, monto: Number(t.monto), soyProveedor: !!t.soyProveedor }));
        if (!pag) return res.json(lista);
        const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM TratosCerrados t ${where}`, [yo, yo]);
        res.json(respuestaPaginada(lista, Number(total), pag));
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

    router.get('/:id/comprobante', async (req, res) => {
        res.json(await tratos.comprobante({
            tratoId: Number(req.params.id),
            usuarioId: req.usuario.id,
            esAdmin: req.usuario.esAdmin
        }));
    });

    return router;
}

module.exports = crearRutasTratos;
