// GET /api/tratos: subastas que gané (emprendedor) o que vendí (proveedor) (de rutas/tratos.js).
// Primero los que siguen abiertos (pendiente / en proceso), luego los más recientes.
// Sin ?pagina responde la lista (hasta 50); con ?pagina=N responde { datos, total, pagina, porPagina, paginas }.
// ?origen=Subasta deja solo los de subastas.
import { urlPublica } from "@/lib/config";
import { cerrarVencidasSiToca } from "@/lib/cierre-subastas";
import { obtenerPool } from "@/lib/db";
import { json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { leerPaginacion, respuestaPaginada } from "@/lib/utilidades";

export const GET = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  // Cierre perezoso: si una subasta suya acaba de vencer, el trato aparece ya
  await cerrarVencidasSiToca(urlPublica(req), { esperar: true });
  const query = new URL(req.url).searchParams;
  const pag = leerPaginacion(query, 6, 20);
  const yo = usuario.id;
  const where = `WHERE (t.proveedor_id = $1 OR t.emprendedor_id = $1)${query.get("origen") === "Subasta" ? " AND t.tipo_origen = 'Subasta'" : ""}`;
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT t.trato_id AS id, t.tipo_origen AS origen, t.origen_id AS "origenId",
            t.descripcion_resumen AS descripcion, t.monto_total AS monto,
            t.estado_trato AS estado, t.fecha_cierre AS fecha,
            (t.proveedor_id = $1) AS "soyProveedor",
            CASE WHEN t.proveedor_id = $1 THEN t.emprendedor_id ELSE t.proveedor_id END AS "contraparteId",
            COALESCE(p.nombre_razon_social, 'Usuario') AS contraparte,
            (SELECT c.puntuacion FROM calificaciones c WHERE c.trato_id = t.trato_id AND c.autor_id = $1 LIMIT 1) AS "miCalificacion",
            (SELECT c.puntuacion FROM calificaciones c WHERE c.trato_id = t.trato_id AND c.autor_id <> $1 LIMIT 1) AS "suCalificacion"
     FROM tratos_cerrados t
     LEFT JOIN perfiles_usuarios p ON p.usuario_id = CASE WHEN t.proveedor_id = $1 THEN t.emprendedor_id ELSE t.proveedor_id END
     ${where}
     ORDER BY (t.estado_trato IN ('Pendiente', 'EnProceso')) DESC, t.fecha_cierre DESC, t.trato_id DESC
     LIMIT $2 OFFSET $3`,
    [yo, pag ? pag.porPagina : 50, pag ? pag.offset : 0]
  );
  const lista = rows.map((t) => ({ ...t, monto: Number(t.monto), soyProveedor: !!t.soyProveedor }));
  if (!pag) return json(lista);
  const {
    rows: [{ total }],
  } = await pool.query(`SELECT count(*)::int AS total FROM tratos_cerrados t ${where}`, [yo]);
  return json(respuestaPaginada(lista, total, pag));
});
