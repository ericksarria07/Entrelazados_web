// ==========================================================================
// KAN: respuestas fijas (gratis, sin gastar la cuota de Gemini) y limpieza del
// historial que manda el navegador. Sin base de datos ni Gemini, para probarlas
// con node --test (pruebas/unidad/). lib/kan.ts las re-exporta.
// ==========================================================================

// Respuestas fijas: si el texto incluye alguna de las frases, se responde sin IA
const RESPUESTAS_ADMIN = [
  {
    frases: ["reporte", "usuarios de hoy", "métricas"],
    respuesta:
      "Puedes consultar las estadísticas globales y la lista completa de usuarios registrados ingresando a tu Panel de Administración (`/admin`).",
  },
  {
    frases: ["modero", "elimino", "lote", "publicación"],
    respuesta:
      "Como administrador, puedes suspender usuarios o eliminar publicaciones inapropiadas/agotadas directamente desde la sección de Moderación en el panel administrativo.",
  },
];

const RESPUESTAS_GENERALES = [
  {
    frases: ["generan las subastas", "publicar un insumo"],
    respuesta:
      "Cada vez que publicas un nuevo material desde tu formulario en el dashboard, el sistema de EntreLazados crea automáticamente un lote en la sección de Subastas utilizando el precio base que estableciste, dándole una vigencia de 7 días para que los emprendedores puedan pujar.",
  },
  {
    frases: ["edito o elimino", "material que ya se agotó"],
    respuesta:
      "En el Mercado, cada publicación tuya tiene los botones Editar y Eliminar. Con Editar cambias el título, el precio, la categoría o las fotos (si tiene una subasta abierta, también se actualiza su título). Con Eliminar retiras el material de la vista pública; si su subasta ya recibió pujas, tendrás que esperar a que cierre.",
  },
  {
    // (no usar solo "materia prima": taparía la respuesta de "cómo busco materia prima")
    frases: ["talleres están interesados", "interesados en mi materia prima"],
    respuesta:
      "Puedes revisar el apartado de Chat en la barra de navegación superior. Ahí recibirás de forma directa los mensajes y consultas de los emprendedores que han visto tus ofertas de cuero, suelas o herrajes.",
  },
  {
    frases: ["contactan los compradores", "compradores"],
    respuesta:
      "Los compradores y talleres se comunicarán contigo directamente mediante el sistema de chat interno de la plataforma o a través de los datos de contacto corporativos que registraste.",
  },
  {
    frases: ["cómo busco materia prima", "buscar materia prima"],
    respuesta:
      "Para buscar materia prima, ve a la pestaña **'Mercado'** en la plataforma. Ahí encontrarás categorías como cuero, suelas, herrajes e hilos publicadas por proveedores nicaragüenses verificados, ordenadas por precio y cercanía.",
  },
  {
    frases: [
      "cómo me contacto con proveedores",
      "pedido especial",
      "contactar proveedores",
    ],
    respuesta:
      "En el perfil de cualquier oferta publicada encontrarás acceso directo al Chat de la plataforma o el número de WhatsApp corporativo registrado por el proveedor para coordinar entregas personalizadas.",
  },
  {
    frases: ["insumos cerca", "radio de envíos", "distancia"],
    respuesta:
      "EntreLazados toma tu departamento registrado y calcula una distancia simulada en kilómetros respecto a la ubicación del proveedor. Puedes ajustar el control deslizante de 'Radio de Cercanía' en la barra superior para encontrar proveedores más próximos.",
  },
  {
    frases: ["funcionan las pujas", "pujas en las subastas"],
    respuesta:
      "En la sección de Subastas verás los lotes activos publicados por los proveedores. Puedes ingresar una oferta económica superior a la puja actual en córdobas (C$) para competir por el lote y adquirir insumos a un precio más competitivo.",
  },
];

const SALUDO =
  "¡Hola! 🤝 Soy Kan, tu guía en EntreLazados. ¿En qué te puedo ayudar hoy con la materia prima para calzado o marroquinería?";
export const SIN_CONEXION_IA =
  "¡Hola! Estoy experimentando problemas temporales al consultar los servidores de IA, pero recuerda que en EntreLazados puedes explorar las pestañas de Mercado y Subastas para gestionar tus insumos con total normalidad.";

const buscarEn = (
  lista: { frases: string[]; respuesta: string }[],
  texto: string,
) => lista.find((r) => r.frases.some((f) => texto.includes(f)));

// Respuesta fija para el texto (ya en minúsculas) o null si hay que preguntarle a la IA
export function respuestaFija(texto: string, esAdmin: boolean): string | null {
  if (esAdmin) {
    const admin = buscarEn(RESPUESTAS_ADMIN, texto);
    if (admin) return admin.respuesta;
  }
  if (
    ["hola", "buenas", "saludos"].includes(texto) ||
    texto.startsWith("hola ")
  )
    return SALUDO;
  const general = buscarEn(RESPUESTAS_GENERALES, texto);
  return general ? general.respuesta : null;
}

// Un mensaje anterior de la conversación (lo manda kan.js para que Kan tenga contexto)
export type MensajeHistorial = { rol: "usuario" | "kan"; texto: string };
const MAX_HISTORIAL = 10;
const LARGO_HISTORIAL = 1000;

// Limpia el historial que manda el navegador: si no es un arreglo se ignora; solo los
// últimos 10 con rol válido y texto, cada uno cortado a 1000 caracteres
export function leerHistorial(valor: unknown): MensajeHistorial[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter(
      (m): m is MensajeHistorial =>
        !!m && typeof m === "object" && (m.rol === "usuario" || m.rol === "kan") && typeof m.texto === "string" && m.texto.trim() !== "",
    )
    .slice(-MAX_HISTORIAL)
    .map((m) => ({ rol: m.rol, texto: m.texto.trim().slice(0, LARGO_HISTORIAL) }));
}
