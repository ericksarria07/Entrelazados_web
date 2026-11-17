// PUT /api/admin/usuarios/[id]/estado { nuevoEstado: 'Activo' | 'Inactivo' | 'Suspendido' }
// Suspendida, la cuenta pierde el acceso al instante (exigirSesion revisa el estado en cada
// petición) y se le cortan los avisos en tiempo real (Ably revoca sus permisos).
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { exigirAdmin } from "@/lib/sesion";
import { revocarTiempoReal } from "@/lib/tiempo-real";
import { enteroPositivo } from "@/lib/utilidades";

const ESTADOS_CUENTA = ["Activo", "Inactivo", "Suspendido"];

export const PUT = ruta<RouteContext<"/api/admin/usuarios/[id]/estado">>(async (req, ctx) => {
  await exigirAdmin(req);
  const { nuevoEstado } = await leerCuerpo(req);
  if (typeof nuevoEstado !== "string" || !ESTADOS_CUENTA.includes(nuevoEstado)) {
    throw new ErrorHttp(400, "Estado no válido. Valores admitidos: Activo, Inactivo, Suspendido.");
  }
  const usuarioId = enteroPositivo((await ctx.params).id);
  if (!usuarioId) throw new ErrorHttp(404, "Usuario no encontrado.");
  const r = await obtenerPool().query("UPDATE usuarios SET estado_cuenta = $1 WHERE usuario_id = $2", [nuevoEstado, usuarioId]);
  if (!r.rowCount) throw new ErrorHttp(404, "Usuario no encontrado.");
  if (nuevoEstado === "Suspendido") await revocarTiempoReal(usuarioId);
  return json({ success: true, message: `Estado del usuario cambiado a '${nuevoEstado}'.` });
});
