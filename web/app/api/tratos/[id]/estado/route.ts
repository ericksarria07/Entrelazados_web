// PUT /api/tratos/[id]/estado { estado: 'EnProceso' | 'Completado' | 'Cancelado', motivo? }
import { urlPublica } from "@/lib/config";
import { json, leerCuerpo, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { cambiarEstado } from "@/lib/tratos";

const MENSAJES_ESTADO: Record<string, string> = {
  EnProceso: "Trato marcado como en proceso.",
  Completado: "¡Trato completado!",
  Cancelado: "Trato cancelado.",
};

export const PUT = ruta<RouteContext<"/api/tratos/[id]/estado">>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  const b = await leerCuerpo(req);
  const resultado = await cambiarEstado(
    { tratoId: Number((await ctx.params).id), usuarioId: usuario.id, estado: b.estado, motivo: b.motivo },
    urlPublica(req)
  );
  return json({ message: `${MENSAJES_ESTADO[resultado.estado]} Le avisamos a la otra parte por el chat.`, ...resultado });
});
