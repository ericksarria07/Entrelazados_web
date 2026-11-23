// ==========================================================================
// GEMINI (Google AI) para Kan y el asistente de publicación
//   Kan usa el Vercel AI SDK (ai + @ai-sdk/google) para responder en streaming;
//   el asistente de publicación sigue con @google/genai (JSON con esquema).
//   GEMINI_API_KEY  clave de Google AI Studio (sin ella: Kan da solo sus respuestas
//                   fijas y el asistente responde "no disponible" o sugiere por estadística)
//   GEMINI_MODELO   modelo (por defecto gemini-3.8-flash, el mismo que usaba Express)
// ==========================================================================
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { GoogleGenAI } from "@google/genai";

let cliente: GoogleGenAI | null | undefined;

export function clienteGemini(): GoogleGenAI | null {
  if (cliente === undefined) {
    const clave = (process.env.GEMINI_API_KEY ?? "").trim();
    // "sin-clave" es lo que pasan las pruebas para dejarlo apagado
    // Tiempo máximo por intento y un solo reintento: si Gemini no responde (o el plan
    // gratis responde 429), se usa el respaldo en segundos en vez de colgar la función
    cliente =
      clave && clave !== "sin-clave"
        ? new GoogleGenAI({ apiKey: clave, httpOptions: { timeout: 20_000, retryOptions: { attempts: 2, maxDelay: 2 } } })
        : null;
  }
  return cliente;
}

export const modeloGemini = () => (process.env.GEMINI_MODELO ?? "").trim() || "gemini-3.8-flash";

// El modelo de Gemini para el AI SDK (Kan), con la misma clave y el mismo modelo.
// null si no hay clave (o es "sin-clave", lo que pasan las pruebas): Kan usa su respaldo.
export function modeloKan() {
  const clave = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!clave || clave === "sin-clave") return null;
  return createGoogleGenerativeAI({ apiKey: clave })(modeloGemini());
}
