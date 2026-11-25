// POST /api/chat/ia { mensajeUsuario, historial? }: pregunta a Kan (de rutas/kan.js).
// historial: los últimos mensajes de la conversación [{ rol: 'usuario'|'kan', texto }],
// para que Kan recuerde lo hablado. Si no es válido se ignora (no es obligatorio).
// Requiere sesión: cada pregunta cuenta para un usuario concreto y nadie puede gastar
// la cuota de Gemini desde fuera. El id y el rol salen de la sesión, no de lo que diga el
// navegador (las herramientas de Kan los usan para "mis subastas").
//
// Dos formas de respuesta, con el mismo código (Vercel AI SDK):
//   - por defecto, JSON { respuesta } con el texto completo (Swagger, scripts, pruebas);
//   - con "Accept: text/plain", la respuesta llega en trozos mientras Gemini la escribe
//     (lo usan el widget de Kan y el chat). Los errores 400/401/429 siguen siendo JSON.
import { json, leerCuerpo, ruta } from "@/lib/http";
import { leerHistorial, respuestaKan, responderKan } from "@/lib/kan";
import { limite } from "@/lib/limites";
import { exigirSesion } from "@/lib/sesion";

const LARGO_MAXIMO = 1000;

export const POST = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  await limite("kanMinuto", `u${usuario.id}`).consumir();
  await limite("kanDia", `u${usuario.id}`).consumir();
  const { mensajeUsuario, historial } = await leerCuerpo(req);
  if (typeof mensajeUsuario !== "string" || !mensajeUsuario.trim()) {
    return json({ error: "El mensaje del usuario es obligatorio." }, 400);
  }
  if (mensajeUsuario.length > LARGO_MAXIMO) {
    return json({ error: `El mensaje es demasiado largo (máximo ${LARGO_MAXIMO} caracteres).` }, 400);
  }

  if (!(req.headers.get("accept") ?? "").includes("text/plain")) {
    return json({ respuesta: await responderKan(mensajeUsuario, usuario, leerHistorial(historial)) });
  }

  const trozos = respuestaKan(mensajeUsuario, usuario, leerHistorial(historial));
  const codificar = new TextEncoder();
  const flujo = new ReadableStream<Uint8Array>({
    async pull(control) {
      try {
        const { value, done } = await trozos.next();
        if (done) control.close();
        else control.enqueue(codificar.encode(value));
      } catch (error) {
        console.error("❌ Error al transmitir la respuesta de Kan:", (error as Error)?.message || error);
        control.close();
      }
    },
    // Si el navegador cierra la conexión, se deja de pedirle texto a Gemini
    async cancel() {
      await trozos.return(undefined);
    },
  });
  return new Response(flujo, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
});
