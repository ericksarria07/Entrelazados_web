// GET /api/favoritos: publicaciones que guardé (de rutas/favoritos.js).
// Sin ?pagina: la lista (hasta 100); con ?pagina=N: { datos, total, pagina, porPagina, paginas }
import { listarFavoritos } from "@/lib/favoritos";
import { json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { leerPaginacion } from "@/lib/utilidades";

export const GET = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  return json(await listarFavoritos(usuario.id, leerPaginacion(new URL(req.url).searchParams, 10)));
});
