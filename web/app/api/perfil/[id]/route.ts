// GET /api/perfil/[id]: perfil completo, el propio o cualquiera si eres admin (de rutas/usuarios.js)
import { ErrorHttp, json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { perfilCompleto } from "@/lib/usuarios";
import { enteroPositivo } from "@/lib/utilidades";

export const GET = ruta<RouteContext<"/api/perfil/[id]">>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  const usuarioId = Number((await ctx.params).id);
  // Cada usuario solo puede ver su propio perfil completo (correo, teléfono, RUC...)
  if (usuarioId !== usuario.id && !usuario.esAdmin) throw new ErrorHttp(403, "No tienes permiso para ver este perfil.");
  if (!enteroPositivo(usuarioId)) throw new ErrorHttp(404, "Usuario no encontrado.");
  const perfil = await perfilCompleto(usuarioId);
  if (!perfil) throw new ErrorHttp(404, "Usuario no encontrado.");
  return json(perfil);
});
