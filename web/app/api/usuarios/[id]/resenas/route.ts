// GET /api/usuarios/[id]/resenas: reseñas recibidas, paginadas (?pagina=&porPagina=, 5 por defecto), sin sesión
import { obtenerPool } from "@/lib/db";
import { json, ruta } from "@/lib/http";
import { usuarioPublico } from "@/lib/usuarios";
import { leerPaginacion, respuestaPaginada } from "@/lib/utilidades";

export const GET = ruta<RouteContext<"/api/usuarios/[id]/resenas">>(async (req, ctx) => {
  const u = await usuarioPublico((await ctx.params).id);
  const query = new URL(req.url).searchParams;
  if (!query.get("pagina")) query.set("pagina", "1");
  const pag = leerPaginacion(query, 5, 20)!;
  const pool = obtenerPool();
  const [{ rows: filas }, { rows: [{ total }] }] = await Promise.all([
    pool.query(
      `SELECT c.calificacion_id AS id, c.puntuacion, c.comentario, c.fecha_calificacion AS fecha,
              COALESCE(p.nombre_razon_social, 'Usuario') AS autor
       FROM calificaciones c
       LEFT JOIN perfiles_usuarios p ON p.usuario_id = c.autor_id
       WHERE c.calificado_id = $1
       ORDER BY c.fecha_calificacion DESC, c.calificacion_id DESC
       LIMIT $2 OFFSET $3`,
      [u.usuario_id, pag.porPagina, pag.offset]
    ),
    pool.query("SELECT count(*)::int AS total FROM calificaciones WHERE calificado_id = $1", [u.usuario_id]),
  ]);
  return json(respuestaPaginada(filas, total, pag));
});
