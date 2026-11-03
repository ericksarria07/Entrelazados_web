// ==========================================================================
// RUTAS PÚBLICAS DE CONSULTA (no piden sesión). Se monta en /api
//   GET /api/ping           ¿el servidor responde?
//   GET /api/categorias     categorías de materiales (formularios y filtros)
//   GET /api/estadisticas   contadores de la página de inicio
// ==========================================================================
const express = require('express');
const { conRespaldo } = require('../utilidades');

function crearRutasPublicas({ db }) {
    const router = express.Router();

    router.get('/ping', (req, res) => {
        res.json({ status: 'ok', message: 'API de EntreLazados operando.' });
    });

    router.get('/categorias', conRespaldo([], async (req, res) => {
        const [categorias] = await db.query('SELECT CategoriaID, NombreCategoria FROM CategoriasMateriales ORDER BY NombreCategoria');
        res.json(categorias);
    }));

    router.get('/estadisticas', conRespaldo({ proveedores: 0, emprendedores: 0, subastas: 0 }, async (req, res) => {
        const [[conteo]] = await db.query(`
            SELECT
                (SELECT COUNT(*) FROM Usuarios WHERE LOWER(TipoRol) = 'proveedor') AS proveedores,
                (SELECT COUNT(*) FROM Usuarios WHERE LOWER(TipoRol) = 'emprendedor') AS emprendedores,
                (SELECT COUNT(*) FROM Subastas WHERE Estado = 'Activa') AS subastas
        `);
        res.json(conteo);
    }));

    return router;
}

module.exports = crearRutasPublicas;
