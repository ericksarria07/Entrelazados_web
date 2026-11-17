// PUT /api/admin/usuarios/[id]/correo { correo }: corregir un correo mal escrito (p. ej. "erick@gmail").
// El administrador lo confirma con la persona, así que la cuenta queda verificada.
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { exigirAdmin } from "@/lib/sesion";
import { REGEX_EMAIL, enteroPositivo, textoLimpio } from "@/lib/utilidades";

export const PUT = ruta<RouteContext<"/api/admin/usuarios/[id]/correo">>(async (req, ctx) => {
  await exigirAdmin(req);
  const usuarioId = enteroPositivo((await ctx.params).id);
  const correoNuevo = textoLimpio((await leerCuerpo(req)).correo);
  if (!REGEX_EMAIL.test(correoNuevo) || correoNuevo.length > 100) {
    throw new ErrorHttp(400, "Escribe un correo válido con su dominio completo (ejemplo: usuario@gmail.com).");
  }
  if (!usuarioId) throw new ErrorHttp(404, "Usuario no encontrado.");
  let actualizadas: number;
  try {
    actualizadas =
      (
        await obtenerPool().query(
          `UPDATE usuarios SET correo_electronico = $1, correo_verificado = true, token_verificacion = NULL, expiracion_verificacion = NULL
           WHERE usuario_id = $2`,
          [correoNuevo, usuarioId]
        )
      ).rowCount ?? 0;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new ErrorHttp(409, "Ese correo ya lo usa otra cuenta.");
    throw err;
  }
  if (!actualizadas) throw new ErrorHttp(404, "Usuario no encontrado.");
  return json({ success: true, message: `Correo actualizado a ${correoNuevo}. La persona ya puede iniciar sesión con él.` });
});
