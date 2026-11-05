// ==========================================================================
// FAVORITOS Y ALERTAS DE BÚSQUEDA (todas piden sesión). Se monta en /api
//   GET    /api/favoritos              publicaciones que guardé
//   GET    /api/favoritos/ids          solo sus números (para pintar los corazones)
//   POST   /api/favoritos/:ofertaId    guardar una publicación
//   DELETE /api/favoritos/:ofertaId    quitarla
//   GET    /api/alertas                mis alertas
//   POST   /api/alertas                { palabraClave?, categoriaId?, precioMaximo? }
//   DELETE /api/alertas/:id            borrar una alerta
// Las reglas y los avisos están en servicios/favoritos.js.
// ==========================================================================
const express = require('express');
const { ErrorHttp } = require('../utilidades');

function crearRutasFavoritos({ favoritos, verificarToken }) {
    const router = express.Router();

    router.get('/favoritos', verificarToken, async (req, res) => {
        res.json(await favoritos.listarFavoritos(req.usuario.id));
    });

    router.get('/favoritos/ids', verificarToken, async (req, res) => {
        res.json(await favoritos.idsFavoritos(req.usuario.id));
    });

    router.post('/favoritos/:ofertaId', verificarToken, async (req, res) => {
        const { ofertaId, nuevo } = await favoritos.agregarFavorito(req.usuario.id, req.params.ofertaId);
        res.status(nuevo ? 201 : 200).json({
            message: nuevo ? 'Guardada en tus favoritos.' : 'Ya estaba en tus favoritos.',
            ofertaId
        });
    });

    router.delete('/favoritos/:ofertaId', verificarToken, async (req, res) => {
        const quitada = await favoritos.quitarFavorito(req.usuario.id, req.params.ofertaId);
        res.json({ message: quitada ? 'Quitada de tus favoritos.' : 'No estaba en tus favoritos.', quitada });
    });

    router.get('/alertas', verificarToken, async (req, res) => {
        res.json(await favoritos.listarAlertas(req.usuario.id));
    });

    router.post('/alertas', verificarToken, async (req, res) => {
        const alerta = await favoritos.crearAlerta(req.usuario.id, req.body || {});
        res.status(201).json({ message: 'Alerta creada: te avisaremos cuando publiquen algo así.', alerta });
    });

    router.delete('/alertas/:id', verificarToken, async (req, res) => {
        // Mismo 404 si no existe o es de otra persona
        if (!(await favoritos.borrarAlerta(req.usuario.id, req.params.id))) {
            throw new ErrorHttp(404, 'Esa alerta no existe.');
        }
        res.json({ message: 'Alerta borrada.' });
    });

    return router;
}

module.exports = crearRutasFavoritos;
