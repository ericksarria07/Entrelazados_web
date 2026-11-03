// ==========================================================================
// CHAT (todas las rutas piden sesión). Se monta en /api/chat
//   GET  /contactos   personas con quien conversar (primero las que tienen mensajes sin leer)
//   GET  /no-leidos   { total, porContacto } para el globito del menú
//   GET  /mensajes    conversación con ?destinatarioId (la marca como leída)
//   POST /enviar      { destinatarioId, texto }
// Kan (POST /api/chat/ia) está en rutas/kan.js.
// Al enviar, el destinatario recibe al instante el evento "chat:mensaje" (tiempo real):
// su página vuelve a pedir la conversación sin esperar.
// ==========================================================================
const express = require('express');
const { ErrorHttp, conRespaldo } = require('../utilidades');

const LARGO_MAXIMO = 2000;

function crearRutasChat({ db, tiempoReal, verificarToken }) {
    const router = express.Router();
    router.use(verificarToken);

    // Se excluye al propio usuario de su lista de contactos.
    // Primero los que tienen mensajes sin leer, luego las conversaciones más recientes.
    router.get('/contactos', conRespaldo([], async (req, res) => {
        const yo = req.usuario.id;
        const [contactos] = await db.query(`
            SELECT
                p.UsuarioID,
                p.NombreRazonSocial,
                COALESCE(u.TipoRol, 'Usuario') AS TipoRol,
                COALESCE(d.NombreDepartamento, 'Nicaragua') AS NombreDepartamento,
                (SELECT COUNT(*) FROM MensajesChat m
                  WHERE m.RemitenteID = p.UsuarioID AND m.DestinatarioID = ? AND m.EsLeido = 0) AS NoLeidos,
                (SELECT MAX(m.FechaEnvio) FROM MensajesChat m
                  WHERE (m.RemitenteID = p.UsuarioID AND m.DestinatarioID = ?)
                     OR (m.RemitenteID = ? AND m.DestinatarioID = p.UsuarioID)) AS UltimoMensaje
            FROM PerfilesUsuarios p
            LEFT JOIN Usuarios u ON p.UsuarioID = u.UsuarioID
            LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
            WHERE p.UsuarioID <> ?
            ORDER BY NoLeidos > 0 DESC, UltimoMensaje IS NULL, UltimoMensaje DESC, p.NombreRazonSocial
        `, [yo, yo, yo, yo]);
        res.json(contactos.map(c => ({ ...c, NoLeidos: Number(c.NoLeidos) })));
    }));

    // MENSAJES NO LEÍDOS: total y por contacto (el menú de todas las páginas lo consulta cada 30 s)
    router.get('/no-leidos', conRespaldo({ total: 0, porContacto: {} }, async (req, res) => {
        const [filas] = await db.query(
            'SELECT RemitenteID, COUNT(*) AS n FROM MensajesChat WHERE DestinatarioID = ? AND EsLeido = 0 GROUP BY RemitenteID',
            [req.usuario.id]
        );
        const porContacto = Object.fromEntries(filas.map(f => [f.RemitenteID, Number(f.n)]));
        res.json({ total: filas.reduce((suma, f) => suma + Number(f.n), 0), porContacto });
    }));

    // Solo se pueden leer conversaciones en las que participa el usuario de la sesión
    router.get('/mensajes', conRespaldo([], async (req, res) => {
        const yo = req.usuario.id;
        const otro = req.query.destinatarioId;
        if (!otro) return res.status(400).json({ message: "Faltan identificadores de usuario." });

        // Abrir la conversación marca como leídos los mensajes que me envió esa persona
        await db.query(
            'UPDATE MensajesChat SET EsLeido = 1, FechaLectura = NOW() WHERE RemitenteID = ? AND DestinatarioID = ? AND EsLeido = 0',
            [otro, yo]
        ).catch(err => console.error('⚠️ No se pudieron marcar los mensajes como leídos:', err.message));

        const [mensajes] = await db.query(`
            SELECT MensajeID, RemitenteID, DestinatarioID, ContenidoTexto, FechaEnvio, EsLeido
            FROM MensajesChat
            WHERE (RemitenteID = ? AND DestinatarioID = ?)
               OR (RemitenteID = ? AND DestinatarioID = ?)
            ORDER BY FechaEnvio ASC, MensajeID ASC
        `, [yo, otro, otro, yo]);
        res.json(mensajes.map(m => ({ ...m, EsLeido: !!m.EsLeido })));
    }));

    // El remitente es siempre el usuario de la sesión (nadie puede escribir "a nombre de" otro)
    router.post('/enviar', async (req, res) => {
        const remitenteId = req.usuario.id;
        const { destinatarioId, texto } = req.body;
        if (!destinatarioId || typeof texto !== 'string' || !texto.trim()) {
            throw new ErrorHttp(400, "Contenido del mensaje incompleto.");
        }
        if (texto.length > LARGO_MAXIMO) {
            throw new ErrorHttp(400, `El mensaje es demasiado largo (máximo ${LARGO_MAXIMO} caracteres).`);
        }
        if (Number(destinatarioId) === remitenteId) {
            throw new ErrorHttp(400, "No puedes enviarte mensajes a ti mismo.");
        }
        await db.query('INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto) VALUES (?, ?, ?)',
            [remitenteId, destinatarioId, texto]);
        // También al remitente: así se actualizan sus otras pestañas abiertas
        tiempoReal.aUsuario([Number(destinatarioId), remitenteId], 'chat:mensaje',
            { remitenteId, destinatarioId: Number(destinatarioId) });
        res.json({ success: true, message: "Mensaje enviado y guardado." });
    });

    return router;
}

module.exports = crearRutasChat;
