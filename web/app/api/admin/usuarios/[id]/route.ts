// DELETE /api/admin/usuarios/[id]: eliminar una cuenta por completo (de rutas/admin.js).
// Ofertas, subastas, pujas, mensajes, tratos y calificaciones apuntan al usuario sin
// ON DELETE CASCADE, así que se borran antes, todo en una transacción (si algo falla
// no se borra nada). Quienes pujaron en sus subastas abiertas reciben un aviso.
import { urlPublica } from "@/lib/config";
import { enTransaccion } from "@/lib/db";
import { borrarFotos } from "@/lib/fotos";
import { ErrorHttp, json, ruta } from "@/lib/http";
import { exigirAdmin } from "@/lib/sesion";
import { avisarCancelacion, avisarPujadoresCancelacion } from "@/lib/subastas";
import { aTodos, revocarTiempoReal } from "@/lib/tiempo-real";
import { enteroPositivo } from "@/lib/utilidades";

const MOTIVO_BAJA = "porque la cuenta del proveedor fue dada de baja";

export const DELETE = ruta<RouteContext<"/api/admin/usuarios/[id]">>(async (req, ctx) => {
  const admin = await exigirAdmin(req);
  const usuarioId = Number((await ctx.params).id);
  if (usuarioId === admin.id) throw new ErrorHttp(400, "No puedes eliminar tu propia cuenta de administrador.");
  if (!enteroPositivo(usuarioId)) throw new ErrorHttp(404, "El usuario a eliminar no existe.");

  const pasos: [string, unknown[]][] = [
    ["DELETE FROM calificaciones WHERE autor_id = $1 OR calificado_id = $1", [usuarioId]],
    ["DELETE FROM mensajes_chat WHERE remitente_id = $1 OR destinatario_id = $1", [usuarioId]],
    ["DELETE FROM tratos_cerrados WHERE proveedor_id = $1 OR emprendedor_id = $1", [usuarioId]],
    ["DELETE FROM pujas WHERE emprendedor_id = $1", [usuarioId]],
    ["DELETE FROM subastas WHERE proveedor_id = $1", [usuarioId]], // sus pujas se borran en cascada
    ["DELETE FROM ofertas WHERE proveedor_id = $1", [usuarioId]], // sus fotos y favoritos, en cascada
    ["DELETE FROM usuarios WHERE usuario_id = $1", [usuarioId]], // perfil, roles, notificaciones, etc. en cascada
  ];

  const { urlsFotos, avisos } = await enTransaccion(async (c) => {
    const { rows: existe } = await c.query("SELECT usuario_id FROM usuarios WHERE usuario_id = $1 FOR UPDATE", [usuarioId]);
    if (!existe.length) throw new ErrorHttp(404, "El usuario a eliminar no existe.");
    // Las fotos de sus ofertas se anotan antes, para borrar los archivos al final
    const { rows: filasFotos } = await c.query<{ foto_url: string }>(
      "SELECT f.foto_url FROM fotos_ofertas f JOIN ofertas o ON o.oferta_id = f.oferta_id WHERE o.proveedor_id = $1",
      [usuarioId]
    );
    // Sus subastas abiertas desaparecen: se avisa por el chat a quienes habían pujado
    const { rows: abiertas } = await c.query<{ subasta_id: number }>(
      "SELECT subasta_id FROM subastas WHERE proveedor_id = $1 AND estado = 'Activa' AND fecha_fin > now()",
      [usuarioId]
    );
    const avisos = await avisarPujadoresCancelacion(c, { subastaIds: abiertas.map((s) => s.subasta_id), remitenteId: admin.id, motivo: MOTIVO_BAJA });
    for (const [sql, params] of pasos) await c.query(sql, params);
    return { urlsFotos: filasFotos.map((f) => f.foto_url), avisos };
  });

  await borrarFotos(urlsFotos);
  await revocarTiempoReal(usuarioId);
  if (avisos.length > 0) aTodos("subastas:cambio", { motivo: "cancelada" });
  await avisarCancelacion(avisos, MOTIVO_BAJA, urlPublica(req));
  const pujadoresAvisados = new Set(avisos.map((a) => a.emprendedorId)).size;
  return json({
    success: true,
    message:
      "Usuario y sus registros asociados eliminados correctamente." +
      (pujadoresAvisados ? ` Avisamos por el chat a ${pujadoresAvisados} persona(s) que habían pujado en sus subastas.` : ""),
    pujadoresAvisados,
  });
});
