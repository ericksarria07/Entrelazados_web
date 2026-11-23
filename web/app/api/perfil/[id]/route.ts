// GET /api/perfil/[id]: perfil completo, el propio o cualquiera si eres admin (de rutas/usuarios.js)
// PUT /api/perfil/[id]: editar mi perfil (solo el propio, también para el admin)
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { actualizarPerfil, perfilCompleto } from "@/lib/usuarios";
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

export const PUT = ruta<RouteContext<"/api/perfil/[id]">>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  const usuarioId = Number((await ctx.params).id);
  // Nadie edita el perfil de otro: ni el admin (para corregir un correo tiene su propia ruta)
  if (usuarioId !== usuario.id) throw new ErrorHttp(403, "Solo puedes editar tu propio perfil.");
  await actualizarPerfil(usuario.id, usuario.rol, await leerCuerpo(req));
  return json(await perfilCompleto(usuario.id));
});
