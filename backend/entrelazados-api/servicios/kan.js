// ==========================================================================
// KAN (RANDAL), EL ASISTENTE VIRTUAL
//
// 1. Primero busca una respuesta fija para las preguntas frecuentes (gratis e
//    instantánea, no gasta la cuota de Gemini).
// 2. Si no la hay, le pregunta a Gemini, dándole como contexto las ofertas y
//    subastas reales de la base de datos.
// Si Gemini falla (clave inválida, sin internet, modelo saturado), responde un
// mensaje amable: Kan nunca deja al usuario con un error.
// ==========================================================================
const { GoogleGenAI } = require('@google/genai');

// Respuestas fijas: si el texto incluye alguna de las frases, se responde sin IA
const RESPUESTAS_ADMIN = [
    {
        frases: ['reporte', 'usuarios de hoy', 'métricas'],
        respuesta: "Puedes consultar las estadísticas globales y la lista completa de usuarios registrados ingresando a tu Panel de Administración (`admin.html`)."
    },
    {
        frases: ['modero', 'elimino', 'lote', 'publicación'],
        respuesta: "Como administrador, puedes suspender usuarios o eliminar publicaciones inapropiadas/agotadas directamente desde la sección de Moderación en el panel administrativo."
    }
];

const RESPUESTAS_GENERALES = [
    {
        frases: ['generan las subastas', 'publicar un insumo'],
        respuesta: "Cada vez que publicas un nuevo material desde tu formulario en el dashboard, el sistema de EntreLazados crea automáticamente un lote en la sección de Subastas utilizando el precio base que estableciste, dándole una vigencia de 7 días para que los emprendedores puedan pujar."
    },
    {
        frases: ['edito o elimino', 'material que ya se agotó'],
        respuesta: "En el Mercado, cada publicación tuya tiene los botones Editar y Eliminar. Con Editar cambias el título, el precio, la categoría o las fotos (si tiene una subasta abierta, también se actualiza su título). Con Eliminar retiras el material de la vista pública; si su subasta ya recibió pujas, tendrás que esperar a que cierre."
    },
    {
        frases: ['talleres están interesados', 'materia prima'],
        respuesta: "Puedes revisar el apartado de Chat en la barra de navegación superior. Ahí recibirás de forma directa los mensajes y consultas de los emprendedores que han visto tus ofertas de cuero, suelas o herrajes."
    },
    {
        frases: ['contactan los compradores', 'compradores'],
        respuesta: "Los compradores y talleres se comunicarán contigo directamente mediante el sistema de chat interno de la plataforma o a través de los datos de contacto corporativos que registraste."
    },
    {
        frases: ['cómo busco materia prima', 'buscar materia prima'],
        respuesta: "Para buscar materia prima, ve a la pestaña **'Mercado'** en la plataforma. Ahí encontrarás categorías como cuero, suelas, herrajes e hilos publicadas por proveedores nicaragüenses verificados, ordenadas por precio y cercanía."
    },
    {
        frases: ['cómo me contacto con proveedores', 'pedido especial', 'contactar proveedores'],
        respuesta: "En el perfil de cualquier oferta publicada encontrarás acceso directo al Chat de la plataforma o el número de WhatsApp corporativo registrado por el proveedor para coordinar entregas personalizadas."
    },
    {
        frases: ['insumos cerca', 'radio de envíos', 'distancia'],
        respuesta: "EntreLazados toma tu departamento registrado y calcula una distancia simulada en kilómetros respecto a la ubicación del proveedor. Puedes ajustar el control deslizante de 'Radio de Cercanía' en la barra superior para encontrar proveedores más próximos."
    },
    {
        frases: ['funcionan las pujas', 'pujas en las subastas'],
        respuesta: "En la sección de Subastas verás los lotes activos publicados por los proveedores. Puedes ingresar una oferta económica superior a la puja actual en córdobas (C$) para competir por el lote y adquirir insumos a un precio más competitivo."
    }
];

const SALUDO = "¡Hola! 🤝 Soy Kan, tu guía en EntreLazados. ¿En qué te puedo ayudar hoy con la materia prima para calzado o marroquinería?";
const SIN_CONEXION_IA = "¡Hola! Estoy experimentando problemas temporales al consultar los servidores de IA, pero recuerda que en EntreLazados puedes explorar las pestañas de Mercado y Subastas para gestionar tus insumos con total normalidad.";

const buscarEn = (lista, texto) => lista.find(r => r.frases.some(f => texto.includes(f)));

// Respuesta fija para el texto (ya en minúsculas) o null si hay que preguntarle a la IA
function respuestaFija(texto, esAdmin) {
    if (esAdmin) {
        const admin = buscarEn(RESPUESTAS_ADMIN, texto);
        if (admin) return admin.respuesta;
    }
    if (['hola', 'buenas', 'saludos'].includes(texto) || texto.startsWith('hola ')) return SALUDO;
    const general = buscarEn(RESPUESTAS_GENERALES, texto);
    return general ? general.respuesta : null;
}

function crearKan({ db, clave, modelo }) {
    let ai = null;
    if (!clave) console.warn('⚠️ GEMINI_API_KEY no está en el .env: Kan solo dará sus respuestas fijas.');
    try {
        ai = new GoogleGenAI({ apiKey: clave || 'CLAVE_TEMPORAL' });
    } catch (err) {
        console.error('⚠️ No se pudo inicializar GoogleGenAI:', err.message);
    }

    // Inventario real para que la IA no invente precios (si la consulta falla, va vacío)
    async function contextoDelMercado() {
        const [[ofertas], [subastas]] = await Promise.all([
            db.query(`
                SELECT o.TituloMaterial, o.Precio, o.UnidadMedida, c.NombreCategoria
                FROM Ofertas o
                JOIN CategoriasMateriales c ON o.CategoriaID = c.CategoriaID
                LIMIT 10`).catch(() => [[]]),
            db.query(`
                SELECT TituloLote, PrecioActual, FechaFin
                FROM Subastas
                WHERE Estado = 'Activa'
                LIMIT 5`).catch(() => [[]])
        ]);
        return {
            ofertas: ofertas.length > 0
                ? ofertas.map(o => `- ${o.TituloMaterial} (${o.NombreCategoria}): C$${o.Precio} por ${o.UnidadMedida}`).join('\n')
                : 'No hay ofertas registradas en este momento.',
            subastas: subastas.length > 0
                ? subastas.map(s => `- ${s.TituloLote}: Puja actual C$${s.PrecioActual}`).join('\n')
                : 'No hay subastas activas actualmente.'
        };
    }

    // mensaje: lo que escribió el usuario; rol: el de su sesión
    async function responder(mensaje, rol) {
        const rolNormalizado = (rol || 'emprendedor').toLowerCase().trim();
        const esAdmin = rolNormalizado === 'administrador' || rolNormalizado === 'admin';
        const fija = respuestaFija(mensaje.toLowerCase().trim(), esAdmin);
        if (fija) return fija;

        const contexto = await contextoDelMercado();
        const instrucciones = `
Eres Kan (también conocido como Randal), el asistente virtual oficial de "EntreLazados" en Nicaragua.
EntreLazados conecta a proveedores de materia prima con emprendedores del sector calzado y marroquinería.

REGLAS DE RESPUESTA:
1. Responde de forma amable, cercana y profesional con modismos amigables del comercio nicaragüense.
2. Si el usuario pregunta por inventario, precios o materiales en venta, utiliza ÚNICAMENTE esta información real:
=== INVENTARIO Y OFERTAS ACTUALES ===
${contexto.ofertas}

=== SUBASTAS ACTIVAS ===
${contexto.subastas}

3. Adapta tu respuesta según el rol: ${rolNormalizado}.
4. Respuestas concisas (máximo 3 párrafos).
`;
        try {
            if (!ai) throw new Error("Cliente de IA no configurado");
            const respuesta = await ai.models.generateContent({
                model: modelo,
                contents: mensaje,
                config: { systemInstruction: instrucciones, temperature: 0.6, maxOutputTokens: 600 }
            });
            return respuesta.text || "Lo siento, no pude procesar tu solicitud.";
        } catch (error) {
            console.error("❌ Error en la API de Gemini:", error.message || error);
            return SIN_CONEXION_IA;
        }
    }

    return { responder };
}

module.exports = { crearKan, respuestaFija };
