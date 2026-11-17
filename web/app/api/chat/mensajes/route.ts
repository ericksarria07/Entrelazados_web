// GET /api/chat/mensajes?destinatarioId=: conversación con esa persona (la marca como leída).
// Solo se pueden leer conversaciones en las que participa el usuario de la sesión.
import { obtenerPool } from "@/lib/db";
import { conRespaldo, json } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { enteroPositivo } from "@/lib/utilidades";

export const GET = conRespaldo([], async (req) => {
  const yo = (await exigirSesion(req)).id;
  const texto = new URL(req.url).searchParams.get("destinatarioId");
  if (!texto) return json({ message: "Faltan identificadores de usuario." }, 400);
  const otro = enteroPositivo(texto);
  if (!otro) return json([]);
  const pool = obtenerPool();
  // Abrir la conversación marca como leídos los mensajes que me envió esa persona
  await pool
    .query(
      "UPDATE mensajes_chat SET es_leido = true, fecha_lectura = now() WHERE remitente_id = $1 AND destinatario_id = $2 AND es_leido = false",
      [otro, yo]
    )
    .catch((err) => console.error("⚠️ No se pudieron marcar los mensajes como leídos:", err.message));
  const { rows } = await pool.query(
    `SELECT mensaje_id AS "MensajeID", remitente_id AS "RemitenteID", destinatario_id AS "DestinatarioID",
            contenido_texto AS "ContenidoTexto", fecha_envio AS "FechaEnvio", es_leido AS "EsLeido"
     FROM mensajes_chat
     WHERE (remitente_id = $1 AND destinatario_id = $2) OR (remitente_id = $2 AND destinatario_id = $1)
     ORDER BY fecha_envio ASC, mensaje_id ASC`,
    [yo, otro]
  );
  return json(rows.map((m) => ({ ...m, EsLeido: !!m.EsLeido })));
});
