// PUT /api/notificaciones/[id]/leida: marca una como leída.
// Mismo 404 si no existe o es de otra persona: no se revela qué notificaciones existen.
import { ErrorHttp, json, ruta } from "@/lib/http";
import { marcarLeida } from "@/lib/notificaciones";
import { exigirSesion } from "@/lib/sesion";
import { enteroPositivo } from "@/lib/utilidades";

export const PUT = ruta<RouteContext<"/api/notificaciones/[id]/leida">>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  const id = enteroPositivo((await ctx.params).id);
  if (!id || !(await marcarLeida(usuario.id, id))) throw new ErrorHttp(404, "Esa notificación no existe.");
  return json({ message: "Notificación marcada como leída." });
});
