// ==========================================================================
// ASISTENTE DE IA PARA PUBLICAR (solo proveedores). Se monta en /api/ia
//   POST /api/ia/publicacion   multipart: una foto en "fotos" y/o "titulo"
//                              -> { titulo, descripcion, categoriaId, categoria, unidad }
//   POST /api/ia/precio        { titulo?, categoriaId, unidad?, ofertaId? }
//                              -> { sugerido, rango, explicacion, fuente, ejemplos... }
// La lógica está en servicios/asistenteIA.js. Nada se guarda: solo se proponen datos.
// ==========================================================================
const express = require('express');
const limites = require('../middlewares/limites');
const fotos = require('../servicios/fotos');
const { ErrorHttp } = require('../utilidades');

function crearRutasIA({ asistenteIA, verificarToken, soloRoles }) {
    const router = express.Router();

    router.post('/publicacion', verificarToken, soloRoles('proveedor'), limites.ia, fotos.recibirFotos, async (req, res) => {
        const archivos = req.files || [];
        if (archivos.length > 1) throw new ErrorHttp(400, 'Envía una sola foto para que la IA la describa.');
        const errorFoto = fotos.validarFotos(archivos);
        if (errorFoto) throw new ErrorHttp(400, errorFoto);
        const foto = archivos[0] ? { buffer: archivos[0].buffer, mimetype: archivos[0].mimetype } : null;
        res.json(await asistenteIA.describirPublicacion({ foto, titulo: (req.body || {}).titulo }));
    });

    router.post('/precio', verificarToken, soloRoles('proveedor'), limites.ia, async (req, res) => {
        res.json(await asistenteIA.sugerirPrecio(req.body || {}));
    });

    return router;
}

module.exports = crearRutasIA;
