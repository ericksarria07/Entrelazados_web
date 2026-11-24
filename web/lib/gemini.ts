// ==========================================================================
// GEMINI (Google AI) con el Vercel AI SDK (ai + @ai-sdk/google)
//   Kan (streamText, en streaming) y el asistente de publicación (generateText con
//   un esquema Zod) usan el mismo modelo.
//   GEMINI_API_KEY  clave de Google AI Studio (sin ella: Kan da solo sus respuestas
//                   fijas y el asistente responde "no disponible" o sugiere por estadística)
//   GEMINI_MODELO   modelo (por defecto gemini-3.8-flash, el mismo que usaba Express)
// ==========================================================================
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export const modeloGemini = () => (process.env.GEMINI_MODELO ?? "").trim() || "gemini-3.8-flash";

// El modelo de Gemini para el AI SDK. null si no hay clave (o es "sin-clave", lo que
// pasan las pruebas para dejarlo apagado): Kan y el asistente usan su respaldo.
export function modeloIA() {
  const clave = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!clave || clave === "sin-clave") return null;
  return createGoogleGenerativeAI({ apiKey: clave })(modeloGemini());
}
