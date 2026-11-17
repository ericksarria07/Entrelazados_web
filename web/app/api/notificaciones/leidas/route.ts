// PUT /api/notificaciones/leidas: marca todas como leídas
import { json, ruta } from "@/lib/http";
import { marcarTodasLeidas } from "@/lib/notificaciones";
import { exigirSesion } from "@/lib/sesion";

export const PUT = ruta(async (req) => {
  const marcadas = await marcarTodasLeidas((await exigirSesion(req)).id);
  return json({ message: "Notificaciones marcadas como leídas.", marcadas });
});
