// ==========================================================================
// UTILIDADES COMPARTIDAS POR LAS RUTAS
// ==========================================================================

// Error "esperado" con su código HTTP: el manejador de errores (middlewares/errores.js)
// responde { message } tal cual. Cualquier otro error se responde como 500 genérico.
//   throw new ErrorHttp(404, 'Esa publicación no existe.');
class ErrorHttp extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;   // datos adicionales para la respuesta (p. ej. { pujas: 3 })
    }
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// La misma regla escrita para MySQL (REGEXP), para buscar correos inválidos en la base
const REGEXP_EMAIL_SQL = '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]{2,}$';

// Los tokens de los enlaces (recuperación y confirmación) son 32 bytes en hexadecimal
const esTokenValido = (token) => typeof token === 'string' && /^[a-f0-9]{64}$/i.test(token);

const textoLimpio = (valor) => (typeof valor === 'string' ? valor.trim() : '');

const enteroPositivo = (valor) => {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : null;
};

// PAGINACIÓN: ?pagina=N&porPagina=M. Si no se pide ?pagina devuelve null y la ruta
// responde la lista completa como antes (compatibilidad con pantallas y scripts viejos).
function leerPaginacion(query, porPaginaDefecto = 12, maximo = 50) {
    if (query.pagina === undefined) return null;
    const pagina = Math.max(1, parseInt(query.pagina, 10) || 1);
    const porPagina = Math.min(maximo, Math.max(1, parseInt(query.porPagina, 10) || porPaginaDefecto));
    return { pagina, porPagina, offset: (pagina - 1) * porPagina };
}

const respuestaPaginada = (datos, total, p) => ({
    datos,
    total,
    pagina: p.pagina,
    porPagina: p.porPagina,
    paginas: Math.max(1, Math.ceil(total / p.porPagina))
});

// Texto para buscar con LIKE: los comodines % y _ que escriba el usuario se toman literales
const patronLike = (texto) => `%${String(texto).trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;

// "erick@gmail.com" -> "e***k@gmail.com" (para mostrar sin revelar el correo completo)
function ocultarCorreo(correo) {
    const [nombre, dominio] = String(correo).split('@');
    if (!dominio) return '';
    const visible = nombre.length <= 2 ? nombre[0] + '***' : nombre[0] + '***' + nombre[nombre.length - 1];
    return `${visible}@${dominio}`;
}

// Promedio de estrellas con un decimal (o null si no hay calificaciones)
const redondearCalificacion = (valor) => (valor === null || valor === undefined ? null : Math.round(Number(valor) * 10) / 10);

// Envuelve una ruta pública de consulta: si la base de datos falla, la página recibe
// `respaldo` (p. ej. una lista vacía) en lugar de un error, y el detalle queda en el log.
//   router.get('/', conRespaldo([], async (req, res) => { ... }));
const conRespaldo = (respaldo, ruta) => async (req, res, next) => {
    try {
        await ruta(req, res, next);
    } catch (err) {
        console.error(`❌ Error en ${req.method} ${req.originalUrl}:`, err.message);
        if (!res.headersSent) res.status(500).json(respaldo);
    }
};

module.exports = {
    ErrorHttp,
    REGEX_EMAIL,
    REGEXP_EMAIL_SQL,
    esTokenValido,
    textoLimpio,
    enteroPositivo,
    leerPaginacion,
    respuestaPaginada,
    patronLike,
    ocultarCorreo,
    redondearCalificacion,
    conRespaldo
};
