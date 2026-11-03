// ==========================================================================
// DOCUMENTACIÓN INTERACTIVA DE LA API (Swagger UI)
//
//   /api/docs           página para leer y probar cada ruta
//   /api/openapi.json   la especificación en crudo (para Postman, Insomnia...)
//
// La especificación se escribe a mano en docs/openapi.yaml. La prueba
// pruebas/unidad/rutas_documentadas.test.js avisa si una ruta del código
// falta ahí. Estas dos rutas no pasan por el límite de peticiones de la API
// (Swagger descarga varios archivos al abrirse).
// ==========================================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const swaggerUi = require('swagger-ui-express');

const ARCHIVO_ESPECIFICACION = path.join(__dirname, '..', 'docs', 'openapi.yaml');

function leerEspecificacion() {
    return YAML.parse(fs.readFileSync(ARCHIVO_ESPECIFICACION, 'utf8'));
}

function crearRutasDocumentacion() {
    const especificacion = leerEspecificacion();
    const opciones = {
        customSiteTitle: 'API de EntreLazados',
        customCss: '.swagger-ui .topbar { display: none }',
        swaggerOptions: {
            persistAuthorization: true,   // el token pegado en "Authorize" sobrevive al recargar
            docExpansion: 'none',         // los grupos empiezan cerrados
            displayRequestDuration: true
        }
    };

    const router = express.Router();
    router.get('/openapi.json', (req, res) => res.json(especificacion));
    router.use('/docs', swaggerUi.serveFiles(especificacion, opciones), swaggerUi.setup(especificacion, opciones));
    return router;
}

module.exports = crearRutasDocumentacion;
module.exports.leerEspecificacion = leerEspecificacion;
