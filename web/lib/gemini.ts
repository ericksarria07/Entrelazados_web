// ==========================================================================
// GEMINI (Google AI) para Kan y el asistente de publicación
//   GEMINI_API_KEY  clave de Google AI Studio (sin ella: Kan da solo sus respuestas
//                   fijas y el asistente responde "no disponible" o sugiere por estadística)
//   GEMINI_MODELO   modelo (por defecto gemini-3.8-flash, el mismo que usaba Express)
// ==========================================================================
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
