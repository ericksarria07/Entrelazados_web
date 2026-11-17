// GET /api/usuarios/[id]/reputacion: promedio, total y últimas calificaciones recibidas (con sesión)
import { ErrorHttp, json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { reputacion } from "@/lib/usuarios";
import { enteroPositivo } from "@/lib/utilidades";

export const GET = ruta<RouteContext<"/api/usuarios/[id]/reputacion">>(async (req, ctx) => {
  await exigirSesion(req);
  const usuarioId = enteroPositivo((await ctx.params).id);
  if (!usuarioId) throw new ErrorHttp(404, "Usuario no encontrado.");
  return json(await reputacion(usuarioId));
});
