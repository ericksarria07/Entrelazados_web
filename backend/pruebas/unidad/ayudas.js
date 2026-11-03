// Ayudas compartidas por las pruebas unitarias (este archivo no es una prueba)
const os = require('os');
const path = require('path');

// servicios/fotos.js crea su carpeta al cargarse: en las pruebas, que sea una temporal
// (hay que requerir este archivo ANTES que cualquier archivo de servicios/).
if (!process.env.UPLOADS_DIR) process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'entrelazados_uploads_unidad');

// Imita lo mínimo de la respuesta de Express: status(), json() y headersSent
function respuestaFalsa() {
    return {
        codigo: 200, cuerpo: null, headersSent: false,
        status(c) { this.codigo = c; return this; },
        json(d) { this.cuerpo = d; this.headersSent = true; return this; }
    };
}

// Ejecuta fn sin mostrar los console.error / console.warn que el código escribe
// a propósito en el log (así la salida de las pruebas queda limpia)
async function silenciarConsola(fn) {
    const { error, warn, log } = console;
    console.error = console.warn = console.log = () => { };
    try {
        return await fn();
    } finally {
        Object.assign(console, { error, warn, log });
    }
}

module.exports = { respuestaFalsa, silenciarConsola };
