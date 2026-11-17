// POST /api/chat/ia { mensajeUsuario, historial? }: pregunta a Kan (de rutas/kan.js).
// historial: los últimos mensajes de la conversación [{ rol: 'usuario'|'kan', texto }],
// para que Kan recuerde lo hablado. Si no es válido se ignora (no es obligatorio).
// Requiere sesión: cada pregunta cuenta para un usuario concreto y nadie puede gastar
// la cuota de Gemini desde fuera. El rol sale de la sesión, no de lo que diga el navegador.
import { json, leerCuerpo, ruta } from "@/lib/http";
import { leerHistorial, responderKan } from "@/lib/kan";
import { limite } from "@/lib/limites";
import { exigirSesion } from "@/lib/sesion";

const LARGO_MAXIMO = 1000;

export const POST = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  limite("kanMinuto", `u${usuario.id}`).consumir();
  limite("kanDia", `u${usuario.id}`).consumir();
  const { mensajeUsuario, historial } = await leerCuerpo(req);
  if (typeof mensajeUsuario !== "string" || !mensajeUsuario.trim()) {
    return json({ error: "El mensaje del usuario es obligatorio." }, 400);
  }
  if (mensajeUsuario.length > LARGO_MAXIMO) {
    return json({ error: `El mensaje es demasiado largo (máximo ${LARGO_MAXIMO} caracteres).` }, 400);
  }
  return json({ respuesta: await responderKan(mensajeUsuario, usuario.rol, leerHistorial(historial)) });
});
