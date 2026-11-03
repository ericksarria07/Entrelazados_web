// ==========================================================================
// NOTIFICACIONES (la campana del menú)          todas piden sesión
//
//   GET  /api/notificaciones              las últimas 30 y cuántas faltan por leer
//   PUT  /api/notificaciones/leidas       marca todas como leídas
//   PUT  /api/notificaciones/:id/leida    marca una como leída
//
// Las notificaciones las crean los servicios (pujas, cierre de subastas,
// tratos...) con servicios/notificaciones.js. Aquí solo se leen.
// ==========================================================================
const express = require('express');
const { ErrorHttp, enteroPositivo } = require('../utilidades');

function crearRutasNotificaciones({ notificaciones, verificarToken }) {
    const router = express.Router();
    router.use(verificarToken);

    router.get('/', async (req, res) => {
        res.json(await notificaciones.listar(req.usuario.id));
    });

    router.put('/leidas', async (req, res) => {
        const marcadas = await notificaciones.marcarTodasLeidas(req.usuario.id);
        res.json({ message: 'Notificaciones marcadas como leídas.', marcadas });
    });

    router.put('/:id/leida', async (req, res) => {
        const id = enteroPositivo(req.params.id);
        // Mismo 404 si no existe o es de otra persona: no se revela qué notificaciones existen
        if (!id || !(await notificaciones.marcarLeida(req.usuario.id, id))) {
            throw new ErrorHttp(404, 'Esa notificación no existe.');
        }
        res.json({ message: 'Notificación marcada como leída.' });
    });

    return router;
}

module.exports = crearRutasNotificaciones;
