// POST /api/favoritos/[ofertaId]: guardar una publicación · DELETE: quitarla
import { agregarFavorito, quitarFavorito } from "@/lib/favoritos";
import { json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";

type Contexto = RouteContext<"/api/favoritos/[ofertaId]">;

export const POST = ruta<Contexto>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  const { ofertaId, nuevo } = await agregarFavorito(usuario.id, (await ctx.params).ofertaId);
  return json({ message: nuevo ? "Guardada en tus favoritos." : "Ya estaba en tus favoritos.", ofertaId }, nuevo ? 201 : 200);
});

export const DELETE = ruta<Contexto>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  const quitada = await quitarFavorito(usuario.id, (await ctx.params).ofertaId);
  return json({ message: quitada ? "Quitada de tus favoritos." : "No estaba en tus favoritos.", quitada });
});
