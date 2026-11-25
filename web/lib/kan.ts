// ==========================================================================
// KAN (RANDAL), EL ASISTENTE VIRTUAL (equivale a servicios/kan.js)
//
// 1. Primero busca una respuesta fija para las preguntas frecuentes (gratis e
//    instantánea, no gasta la cuota de Gemini).
// 2. Si no la hay, le pregunta a Gemini, que consulta el mercado real con
//    herramientas (lib/kan-herramientas.ts): busca ofertas, subastas, las del propio
//    usuario y precios de referencia, en vez de recibir todo el inventario en el mensaje.
// Si Gemini falla o no está configurado, responde un mensaje amable: Kan nunca
// deja al usuario con un error.
// ==========================================================================
import { type ModelMessage, isStepCount, streamText } from "ai";
import { modeloIA } from "@/lib/gemini";
import { herramientasDeKan, nombresDeCategorias } from "@/lib/kan-herramientas";
import type { Usuario } from "@/lib/sesion";

// Respuestas fijas, saludo y limpieza del historial viven en kan-respuestas.ts
// (sin base de datos ni Gemini, para las pruebas unitarias)
import { type MensajeHistorial, SIN_CONEXION_IA, leerHistorial, respuestaFija } from "@/lib/kan-respuestas";
export { leerHistorial, respuestaFija, type MensajeHistorial };

// Respuesta de Kan en trozos de texto, para mostrarla mientras se escribe (streaming con el
// Vercel AI SDK). mensaje: lo que escribió el usuario; usuario: el de la sesión (id y rol,
// para "mis subastas"); historial: lo hablado antes. Kan nunca deja al usuario con un error: si Gemini no está configurado o
// falla antes de escribir algo, el único trozo es el mensaje de respaldo.
export async function* respuestaKan(
  mensaje: string,
  usuario: Pick<Usuario, "id" | "rol">,
  historial: MensajeHistorial[] = [],
): AsyncGenerator<string> {
  const rolNormalizado = (usuario.rol || "emprendedor").toLowerCase().trim();
  const esAdmin = rolNormalizado === "administrador" || rolNormalizado === "admin";
  const fija = respuestaFija(mensaje.toLowerCase().trim(), esAdmin);
  if (fija) {
    yield fija;
    return;
  }

  const modelo = modeloIA();
  if (!modelo) {
    yield SIN_CONEXION_IA;
    return;
  }
  const categorias = await nombresDeCategorias();
  const instrucciones = `
Eres Kan (también conocido como Randal), el asistente virtual oficial de "EntreLazados" en Nicaragua.
EntreLazados conecta a proveedores de materia prima con emprendedores del sector calzado y marroquinería.

REGLAS DE RESPUESTA:
1. Responde de forma amable, cercana y profesional, como un vendedor nicaragüense de confianza. Saluda en pocas palabras y sin apodos para el usuario.
2. Para inventario, precios, subastas o "mis subastas/pujas", consulta SIEMPRE las herramientas antes de responder y usa ÚNICAMENTE lo que devuelvan. Nunca inventes materiales, precios ni proveedores. No anuncies que vas a buscar: busca y responde. Si no hay resultados, dilo.
3. Los precios están en córdobas: escríbelos como C$ seguido del número.
4. Categorías del mercado: ${categorias.join(", ") || "(no disponibles)"}.
5. El usuario es ${rolNormalizado}; adapta la respuesta a su rol.
6. Respuestas concisas (máximo 3 párrafos).
`;
  // streamText no lanza los errores: los avisa por onError (o, si vence el tiempo, el texto
  // simplemente termina sin nada). Por eso, si no llegó ningún trozo, se usa el respaldo.
  const resultado = streamText({
    model: modelo,
    instructions: instrucciones,
    messages: conversacionParaGemini(historial, mensaje),
    tools: herramientasDeKan(usuario),
    // Hasta 3 rondas de herramientas y una para escribir la respuesta
    stopWhen: isStepCount(4),
    temperature: 0.6,
    maxOutputTokens: 600,
    // Un solo reintento y 20 s para el primer trozo: si Gemini no responde (o el plan
    // gratis responde 429), se usa el respaldo en segundos en vez de colgar la función
    maxRetries: 1,
    timeout: { firstChunkMs: 20_000, totalMs: 45_000 },
    // En los registros de Vercel queda qué consultó Kan (sin los datos)
    onStepFinish: ({ toolCalls }) => {
      if (toolCalls.length) console.info("Kan consultó:", toolCalls.map((c) => c.toolName).join(", "));
    },
    onError: ({ error }) => {
      console.error("❌ Error en la API de Gemini:", (error as Error)?.message || error);
    },
  });
  let escribio = false;
  try {
    for await (const trozo of resultado.textStream) {
      if (!trozo) continue;
      escribio = true;
      yield trozo;
    }
  } catch (error) {
    console.error("❌ Error en la API de Gemini:", (error as Error)?.message || error);
  }
  if (!escribio) yield SIN_CONEXION_IA;
}

// La respuesta completa de una vez (POST /api/chat/ia sin streaming: Swagger, scripts, pruebas)
export async function responderKan(
  mensaje: string,
  usuario: Pick<Usuario, "id" | "rol">,
  historial: MensajeHistorial[] = [],
): Promise<string> {
  let texto = "";
  for await (const trozo of respuestaKan(mensaje, usuario, historial)) texto += trozo;
  return texto;
}

// Historial + pregunta nueva como mensajes del AI SDK. La conversación tiene que empezar
// con el usuario, así que se quitan las respuestas de Kan que queden al principio
// (por ejemplo, la respuesta a una pregunta rápida)
function conversacionParaGemini(historial: MensajeHistorial[], mensaje: string): ModelMessage[] {
  const turnos: ModelMessage[] = historial.map((m) =>
    m.rol === "kan" ? { role: "assistant", content: m.texto } : { role: "user", content: m.texto }
  );
  while (turnos.length && turnos[0].role === "assistant") turnos.shift();
  return [...turnos, { role: "user", content: mensaje }];
}
