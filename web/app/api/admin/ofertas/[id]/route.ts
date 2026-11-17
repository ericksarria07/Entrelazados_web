// DELETE /api/admin/ofertas/[id]: retirar una publicación por moderación (de rutas/admin.js).
// Si su subasta abierta tenía pujas, se cancela y se avisa a quienes pujaron.
import { urlPublica } from "@/lib/config";
import { ErrorHttp, json, ruta } from "@/lib/http";
import { eliminarOferta, mensajeOfertaBorrada } from "@/lib/ofertas";
import { exigirAdmin } from "@/lib/sesion";

export const DELETE = ruta<RouteContext<"/api/admin/ofertas/[id]">>(async (req, ctx) => {
  const admin = await exigirAdmin(req);
  const resultado = await eliminarOferta((await ctx.params).id, { moderadorId: admin.id, urlBase: urlPublica(req) });
  if (!resultado.borrada) throw new ErrorHttp(404, "La oferta no existe o ya fue eliminada.");
  return json({
    success: true,
    message: mensajeOfertaBorrada(resultado, "Publicación eliminada por moderación administrativa."),
    subastasCanceladas: resultado.subastasCanceladas,
    pujadoresAvisados: resultado.pujadoresAvisados,
  });
});
