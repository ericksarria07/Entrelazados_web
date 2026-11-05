// ==========================================================================
// LÍMITES DE INTENTOS (protección contra fuerza bruta y abuso)
//
// Cada límite cuenta las peticiones de una misma IP (o de un mismo usuario
// en el caso de Kan) dentro de una ventana de tiempo. Al pasarse, el servidor
// responde 429 "Demasiados intentos" hasta que la ventana termina.
//
// Los valores se pueden cambiar en el .env sin tocar el código:
//   LIMITE_LOGIN          intentos FALLIDOS de login por IP cada 15 min (10)
//   LIMITE_REGISTRO       cuentas nuevas por IP cada hora                (5)
//   LIMITE_RECUPERACION   solicitudes de recuperación por IP cada 15 min (5)
//   LIMITE_KAN_MINUTO     preguntas a Kan por usuario cada minuto       (10)
//   LIMITE_KAN_DIA        preguntas a Kan por usuario cada día         (150)
//   LIMITE_API            peticiones a /api por IP cada minuto         (300)
//   LIMITE_FOTOS          publicaciones con fotos por usuario cada hora (20)
//   LIMITE_IA             consultas al asistente de IA por usuario cada hora (30)
//
// Los contadores viven en la memoria del proceso: si PM2 reinicia el
// servidor, vuelven a cero (suficiente para un solo servidor).
// ==========================================================================
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const MINUTO = 60 * 1000;

function numeroEnv(nombre, porDefecto) {
    const valor = Number(process.env[nombre]);
    return Number.isInteger(valor) && valor > 0 ? valor : porDefecto;
}

function crearLimite({ nombre, ventanaMs, limite, mensaje, porUsuario = false, soloFallidos = false }) {
    return rateLimit({
        windowMs: ventanaMs,
        limit: limite,
        identifier: nombre,
        // Encabezados estándar RateLimit / RateLimit-Policy (el navegador puede saber cuánto falta)
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        // Si solo cuentan los fallidos, un login correcto no gasta intentos
        skipSuccessfulRequests: soloFallidos,
        // Por usuario (requiere verificarToken antes) o por IP.
        // ipKeyGenerator agrupa las IPv6 por bloque para que no se pueda esquivar cambiando de IP.
        keyGenerator: (req) => (porUsuario && req.usuario ? `u${req.usuario.id}` : ipKeyGenerator(req.ip)),
        handler: (req, res, next, opciones) => {
            const segundos = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
            const minutos = Math.max(1, Math.ceil(segundos / 60));
            console.warn(`⚠️ Límite "${nombre}" alcanzado por ${porUsuario && req.usuario ? 'usuario ' + req.usuario.id : 'IP ' + req.ip}`);
            res.status(opciones.statusCode).json({
                message: `${mensaje} Intenta de nuevo en ${minutos} minuto${minutos === 1 ? '' : 's'}.`,
                reintentarEnSegundos: segundos
            });
        }
    });
}

const limites = {
    api: crearLimite({
        nombre: 'api', ventanaMs: MINUTO, limite: numeroEnv('LIMITE_API', 300),
        mensaje: 'Estás haciendo demasiadas peticiones.'
    }),
    login: crearLimite({
        nombre: 'login', ventanaMs: 15 * MINUTO, limite: numeroEnv('LIMITE_LOGIN', 10), soloFallidos: true,
        mensaje: 'Demasiados intentos fallidos de inicio de sesión.'
    }),
    registro: crearLimite({
        nombre: 'registro', ventanaMs: 60 * MINUTO, limite: numeroEnv('LIMITE_REGISTRO', 5),
        mensaje: 'Se crearon demasiadas cuentas desde esta conexión.'
    }),
    recuperacion: crearLimite({
        nombre: 'recuperacion', ventanaMs: 15 * MINUTO, limite: numeroEnv('LIMITE_RECUPERACION', 5),
        mensaje: 'Demasiadas solicitudes para recuperar la contraseña.'
    }),
    kanMinuto: crearLimite({
        nombre: 'kan-minuto', ventanaMs: MINUTO, limite: numeroEnv('LIMITE_KAN_MINUTO', 10), porUsuario: true,
        mensaje: 'Le estás escribiendo muy rápido a Kan.'
    }),
    kanDia: crearLimite({
        nombre: 'kan-dia', ventanaMs: 24 * 60 * MINUTO, limite: numeroEnv('LIMITE_KAN_DIA', 150), porUsuario: true,
        mensaje: 'Llegaste al máximo de preguntas a Kan por hoy.'
    }),
    fotos: crearLimite({
        nombre: 'fotos', ventanaMs: 60 * MINUTO, limite: numeroEnv('LIMITE_FOTOS', 20), porUsuario: true,
        mensaje: 'Publicaste demasiadas ofertas en poco tiempo.'
    }),
    ia: crearLimite({
        nombre: 'ia', ventanaMs: 60 * MINUTO, limite: numeroEnv('LIMITE_IA', 30), porUsuario: true,
        mensaje: 'Usaste mucho el asistente de IA en poco tiempo.'
    })
};

module.exports = limites;
