// ==========================================================================
// MANEJO CENTRALIZADO DE ERRORES
//
// Express 5 atrapa los errores de las rutas async: si una ruta lanza un error
// (o una consulta falla), llega aquí sin necesidad de try/catch en cada ruta.
//   - ErrorHttp (utilidades.js): error esperado, se responde su mensaje y código.
//   - Cualquier otro: se escribe el detalle en el log y el usuario solo ve un
//     mensaje genérico (nunca rutas de archivos ni detalles de la base de datos).
// ==========================================================================
const { ErrorHttp } = require('../utilidades');

// Rutas de la API que no existen
function rutaNoEncontrada(req, res) {
    res.status(404).json({ message: "Ruta no encontrada." });
}

// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, next) {
    if (err instanceof ErrorHttp) {
        return res.status(err.status).json({ message: err.message, ...err.extra });
    }
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ message: "Formato de datos inválido." });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ message: "Los datos enviados son demasiado grandes." });
    }
    console.error(`❌ Error no controlado en ${req.method} ${req.originalUrl}:`, err.stack || err.message);
    if (res.headersSent) return;
    res.status(500).json({ message: "Error interno del servidor." });
}

module.exports = { rutaNoEncontrada, manejadorErrores };
