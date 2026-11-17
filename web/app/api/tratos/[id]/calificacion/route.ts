// POST /api/tratos/[id]/calificacion { puntuacion: 1..5, comentario? }
import { urlPublica } from "@/lib/config";
import { json, leerCuerpo, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { calificar } from "@/lib/tratos";

export const POST = ruta<RouteContext<"/api/tratos/[id]/calificacion">>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  const b = await leerCuerpo(req);
  const resultado = await calificar(
    { tratoId: Number((await ctx.params).id), usuarioId: usuario.id, puntuacion: b.puntuacion, comentario: b.comentario },
    urlPublica(req)
  );
  return json({ message: "¡Gracias por calificar! Le avisamos a la otra parte por el chat.", ...resultado }, 201);
});
