// POST /api/chat/enviar { destinatarioId, texto }. El remitente es siempre el usuario de la sesión.
// El destinatario (y las otras pestañas del remitente) reciben "chat:mensaje" en tiempo real.
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { aUsuario } from "@/lib/tiempo-real";
import { enteroPositivo } from "@/lib/utilidades";

const LARGO_MAXIMO = 2000;

export const POST = ruta(async (req) => {
  const remitenteId = (await exigirSesion(req)).id;
  const { destinatarioId, texto } = await leerCuerpo(req);
  if (!destinatarioId || typeof texto !== "string" || !texto.trim()) throw new ErrorHttp(400, "Contenido del mensaje incompleto.");
  if (texto.length > LARGO_MAXIMO) throw new ErrorHttp(400, `El mensaje es demasiado largo (máximo ${LARGO_MAXIMO} caracteres).`);
  const destino = enteroPositivo(destinatarioId);
  if (destino === remitenteId) throw new ErrorHttp(400, "No puedes enviarte mensajes a ti mismo.");
  if (!destino) throw new ErrorHttp(404, "Esa persona no existe.");
  try {
    await obtenerPool().query("INSERT INTO mensajes_chat (remitente_id, destinatario_id, contenido_texto) VALUES ($1, $2, $3)", [
      remitenteId,
      destino,
      texto,
    ]);
  } catch (err) {
    // 23503: el destinatario no existe (llave foránea)
    if ((err as { code?: string }).code === "23503") throw new ErrorHttp(404, "Esa persona no existe.");
    throw err;
  }
  for (const id of [destino, remitenteId]) aUsuario(id, "chat:mensaje", { remitenteId, destinatarioId: destino });
  return json({ success: true, message: "Mensaje enviado y guardado." });
});
