// ==========================================================================
// KAN: POST /api/chat/ia  { mensajeUsuario }
// Requiere sesión: así cada pregunta cuenta para un usuario concreto y nadie
// puede gastar la cuota de Gemini desde fuera de la plataforma.
// La lógica de las respuestas está en servicios/kan.js.
// ==========================================================================
const express = require('express');
const limites = require('../middlewares/limites');

const LARGO_MAXIMO = 1000;

function crearRutasKan({ kan, verificarToken }) {
    const router = express.Router();

    router.post('/', verificarToken, limites.kanMinuto, limites.kanDia, async (req, res) => {
        const { mensajeUsuario } = req.body;
        if (typeof mensajeUsuario !== 'string' || !mensajeUsuario.trim()) {
            return res.status(400).json({ error: "El mensaje del usuario es obligatorio." });
        }
        if (mensajeUsuario.length > LARGO_MAXIMO) {
            return res.status(400).json({ error: `El mensaje es demasiado largo (máximo ${LARGO_MAXIMO} caracteres).` });
        }
        // El rol sale de la sesión, no de lo que diga el navegador
        res.json({ respuesta: await kan.responder(mensajeUsuario, req.usuario.rol) });
    });

    return router;
}

module.exports = crearRutasKan;
