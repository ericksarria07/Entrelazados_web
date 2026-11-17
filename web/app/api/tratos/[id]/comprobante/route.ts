// GET /api/tratos/[id]/comprobante: datos para imprimir el comprobante (las dos partes o el admin)
import { json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { comprobante } from "@/lib/tratos";

export const GET = ruta<RouteContext<"/api/tratos/[id]/comprobante">>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  return json(await comprobante({ tratoId: Number((await ctx.params).id), usuarioId: usuario.id, esAdmin: usuario.esAdmin }));
});
