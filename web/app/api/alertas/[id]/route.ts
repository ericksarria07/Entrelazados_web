// DELETE /api/alertas/[id]: borrar una alerta. Mismo 404 si no existe o es de otra persona.
import { borrarAlerta } from "@/lib/favoritos";
import { ErrorHttp, json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";

export const DELETE = ruta<RouteContext<"/api/alertas/[id]">>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  if (!(await borrarAlerta(usuario.id, (await ctx.params).id))) throw new ErrorHttp(404, "Esa alerta no existe.");
  return json({ message: "Alerta borrada." });
});
