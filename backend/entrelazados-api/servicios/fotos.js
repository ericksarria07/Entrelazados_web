// ==========================================================================
// FOTOS DE LAS OFERTAS
//
// Las fotos llegan como archivos (multipart/form-data, campo "fotos") y se
// guardan en disco, en UPLOADS_DIR/ofertas/ (por defecto entrelazados-api/uploads).
// En la base de datos (tabla FotosOfertas) solo se guarda la dirección, por
// ejemplo "/uploads/ofertas/3f9c...e1.webp".
//
// Reglas:
//   * máximo 5 fotos por oferta y 5 MB por foto (el navegador ya las reduce)
//   * solo JPG, PNG o WebP; el tipo se comprueba con los primeros bytes del
//     archivo (no con la extensión, que cualquiera puede cambiar)
//   * el nombre del archivo lo genera el servidor (aleatorio), nunca el usuario
// ==========================================================================
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MAX_FOTOS = 5;
const MAX_BYTES = 5 * 1024 * 1024;

const CARPETA_UPLOADS = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));
const CARPETA_OFERTAS = path.join(CARPETA_UPLOADS, 'ofertas');
const PREFIJO_URL = '/uploads/ofertas/';

fs.mkdirSync(CARPETA_OFERTAS, { recursive: true });

// Firma (primeros bytes) de cada formato permitido
function detectarFormato(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
}

const receptor = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: MAX_FOTOS, fields: 20, fieldSize: 10 * 1024 },
    fileFilter: (req, archivo, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(archivo.mimetype)) return cb(null, true);
        const e = new Error('TIPO');
        e.code = 'TIPO_NO_PERMITIDO';
        cb(e);
    }
}).array('fotos', MAX_FOTOS);

// Middleware: recibe las fotos y traduce los errores de multer a mensajes claros
function recibirFotos(req, res, next) {
    receptor(req, res, (err) => {
        if (!err) return next();
        const mensajes = {
            LIMIT_FILE_SIZE: `Cada foto puede pesar como máximo ${MAX_BYTES / 1024 / 1024} MB.`,
            LIMIT_FILE_COUNT: `Puedes subir como máximo ${MAX_FOTOS} fotos por oferta.`,
            LIMIT_UNEXPECTED_FILE: `Puedes subir como máximo ${MAX_FOTOS} fotos por oferta.`,
            TIPO_NO_PERMITIDO: 'Solo se aceptan fotos en formato JPG, PNG o WebP.'
        };
        res.status(400).json({ message: mensajes[err.code] || 'No se pudieron recibir las fotos.' });
    });
}

// Revisa el contenido de cada foto. Devuelve un mensaje de error o null si todas son válidas.
function validarFotos(archivos) {
    for (const archivo of archivos || []) {
        if (!detectarFormato(archivo.buffer)) {
            return `"${archivo.originalname}" no es una imagen JPG, PNG o WebP válida.`;
        }
    }
    return null;
}

// Guarda las fotos en disco y devuelve sus direcciones públicas (en el mismo orden)
async function guardarFotos(archivos) {
    const urls = [];
    try {
        for (const archivo of archivos || []) {
            const nombre = `${crypto.randomUUID()}.${detectarFormato(archivo.buffer)}`;
            await fs.promises.writeFile(path.join(CARPETA_OFERTAS, nombre), archivo.buffer, { flag: 'wx' });
            urls.push(PREFIJO_URL + nombre);
        }
        return urls;
    } catch (err) {
        await borrarFotos(urls);   // si falla una, no quedan archivos a medias
        throw err;
    }
}

// Borra del disco las fotos indicadas por su dirección. Ignora las que no
// son de esta carpeta (por ejemplo fotos antiguas guardadas como texto).
async function borrarFotos(urls) {
    for (const url of urls || []) {
        if (typeof url !== 'string' || !url.startsWith(PREFIJO_URL)) continue;
        const nombre = path.basename(url);   // evita rutas como ../../index.js
        try {
            await fs.promises.unlink(path.join(CARPETA_OFERTAS, nombre));
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('⚠️ No se pudo borrar la foto', nombre, err.message);
        }
    }
}

module.exports = { recibirFotos, validarFotos, guardarFotos, borrarFotos, CARPETA_UPLOADS, MAX_FOTOS };
