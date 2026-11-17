// PUT /api/admin/usuarios/[id]/verificar: dar por confirmado el correo (si no le llega el enlace)
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, ruta } from "@/lib/http";
import { exigirAdmin } from "@/lib/sesion";
import { enteroPositivo } from "@/lib/utilidades";

export const PUT = ruta<RouteContext<"/api/admin/usuarios/[id]/verificar">>(async (req, ctx) => {
  await exigirAdmin(req);
  const usuarioId = enteroPositivo((await ctx.params).id);
  if (!usuarioId) throw new ErrorHttp(404, "Usuario no encontrado.");
  const r = await obtenerPool().query(
    "UPDATE usuarios SET correo_verificado = true, token_verificacion = NULL, expiracion_verificacion = NULL WHERE usuario_id = $1",
    [usuarioId]
  );
  if (!r.rowCount) throw new ErrorHttp(404, "Usuario no encontrado.");
  return json({ success: true, message: "Correo marcado como confirmado. La cuenta ya puede iniciar sesión." });
});
