// ==========================================================================
// KAN (RANDAL), EL ASISTENTE VIRTUAL (equivale a servicios/kan.js)
//
// 1. Primero busca una respuesta fija para las preguntas frecuentes (gratis e
//    instantánea, no gasta la cuota de Gemini).
// 2. Si no la hay, le pregunta a Gemini, dándole como contexto las ofertas y
//    subastas reales de la base de datos.
// Si Gemini falla o no está configurado, responde un mensaje amable: Kan nunca
// deja al usuario con un error.
// ==========================================================================
import { obtenerPool } from "@/lib/db";
import { clienteGemini, modeloGemini } from "@/lib/gemini";

// Respuestas fijas, saludo y limpieza del historial viven en kan-respuestas.ts
// (sin base de datos ni Gemini, para las pruebas unitarias)
import { type MensajeHistorial, SIN_CONEXION_IA, leerHistorial, respuestaFija } from "@/lib/kan-respuestas";
export { leerHistorial, respuestaFija, type MensajeHistorial };

// Inventario real para que la IA no invente precios (si la consulta falla, va vacío)
async function contextoDelMercado() {
  const pool = obtenerPool();
  const [ofertas, subastas] = await Promise.all([
    pool
      .query(
        `SELECT o.titulo_material, o.precio, o.unidad_medida, c.nombre_categoria
         FROM ofertas o JOIN categorias_materiales c ON o.categoria_id = c.categoria_id
         LIMIT 10`,
      )
      .then(
        (r) => r.rows,
        () => [],
      ),
    pool
      .query(
        "SELECT titulo_lote, precio_actual FROM subastas WHERE estado = 'Activa' AND fecha_fin > now() LIMIT 5",
      )
      .then(
        (r) => r.rows,
        () => [],
      ),
  ]);
  return {
    ofertas: ofertas.length
      ? ofertas
          .map(
            (o) =>
              `- ${o.titulo_material} (${o.nombre_categoria}): C$${o.precio} por ${o.unidad_medida}`,
          )
          .join("\n")
      : "No hay ofertas registradas en este momento.",
    subastas: subastas.length
      ? subastas
          .map((s) => `- ${s.titulo_lote}: Puja actual C$${s.precio_actual}`)
          .join("\n")
      : "No hay subastas activas actualmente.",
  };
}

// mensaje: lo que escribió el usuario; rol: el de su sesión; historial: lo hablado antes
export async function responderKan(
  mensaje: string,
  rol: string,
  historial: MensajeHistorial[] = [],
): Promise<string> {
  const rolNormalizado = (rol || "emprendedor").toLowerCase().trim();
  const esAdmin =
    rolNormalizado === "administrador" || rolNormalizado === "admin";
  const fija = respuestaFija(mensaje.toLowerCase().trim(), esAdmin);
  if (fija) return fija;

  const ai = clienteGemini();
  if (!ai) return SIN_CONEXION_IA;
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
    const respuesta = await ai.models.generateContent({
      model: modeloGemini(),
      contents: conversacionParaGemini(historial, mensaje),
      config: {
        systemInstruction: instrucciones,
        temperature: 0.6,
        maxOutputTokens: 600,
      },
    });
    return respuesta.text || "Lo siento, no pude procesar tu solicitud.";
  } catch (error) {
    console.error(
      "❌ Error en la API de Gemini:",
      (error as Error).message || error,
    );
    return SIN_CONEXION_IA;
  }
}

// Historial + pregunta nueva como turnos de Gemini. La conversación tiene que empezar
// con el usuario, así que se quitan las respuestas de Kan que queden al principio
// (por ejemplo, la respuesta a una pregunta rápida)
function conversacionParaGemini(historial: MensajeHistorial[], mensaje: string) {
  const turnos = historial.map((m) => ({ role: m.rol === "kan" ? "model" : "user", parts: [{ text: m.texto }] }));
  while (turnos.length && turnos[0].role === "model") turnos.shift();
  return [...turnos, { role: "user", parts: [{ text: mensaje }] }];
}
