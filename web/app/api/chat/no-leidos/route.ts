// GET /api/chat/no-leidos: { total, porContacto } para el globito del menú (sesion.js lo consulta cada 30 s)
import { obtenerPool } from "@/lib/db";
import { conRespaldo, json } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";

export const GET = conRespaldo({ total: 0, porContacto: {} }, async (req) => {
  const yo = (await exigirSesion(req)).id;
  const { rows } = await obtenerPool().query<{ remitente_id: number; n: number }>(
    "SELECT remitente_id, count(*)::int AS n FROM mensajes_chat WHERE destinatario_id = $1 AND es_leido = false GROUP BY remitente_id",
    [yo]
  );
  const porContacto = Object.fromEntries(rows.map((f) => [f.remitente_id, f.n]));
  return json({ total: rows.reduce((suma, f) => suma + f.n, 0), porContacto });
});
