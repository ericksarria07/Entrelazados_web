// Preguntarle a Kan desde el navegador y recibir la respuesta mientras se escribe.
// POST /api/chat/ia con "Accept: text/plain": el texto llega en trozos (Vercel AI SDK).
// alEscribir recibe el texto acumulado cada vez que llega un trozo. Devuelve el texto final.
// Si la ruta responde un error (400, 401 sin sesión, 429 por el límite), devuelve el mensaje
// de la ruta como respuesta de Kan, igual que antes. Usa fetch directo y no api(): Kan
// también aparece sin sesión y un 401 no debe mandar a /login.
export type MensajeHistorialKan = { rol: "usuario" | "kan"; texto: string };

export async function preguntarAKan(
  mensaje: string,
  historial: MensajeHistorialKan[],
  alEscribir: (textoHastaAhora: string) => void
): Promise<string> {
  const res = await fetch("/api/chat/ia", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/plain" },
    body: JSON.stringify({ mensajeUsuario: mensaje, historial }),
  });
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").startsWith("text/plain")) {
    let datos: { respuesta?: string; error?: string; message?: string } = {};
    try {
      datos = await res.json();
    } catch {
      /* sin cuerpo */
    }
    const texto = datos.respuesta || datos.error || datos.message || "No pude responder en este momento.";
    alEscribir(texto);
    return texto;
  }
  const lector = res.body.getReader();
  const decodificar = new TextDecoder();
  let texto = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    texto += decodificar.decode(value, { stream: true });
    alEscribir(texto);
  }
  texto += decodificar.decode();
  return texto.trim() || "No pude responder en este momento.";
}
