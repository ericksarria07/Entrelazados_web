// GET /api/categorias: categorías de materiales para los formularios y filtros (de rutas/publicas.js)
import { obtenerPool } from "@/lib/db";
import { conRespaldo, json } from "@/lib/http";

export const GET = conRespaldo([], async () => {
  const { rows } = await obtenerPool().query(
    'SELECT categoria_id AS "CategoriaID", nombre_categoria AS "NombreCategoria" FROM categorias_materiales ORDER BY nombre_categoria'
  );
  return json(rows);
});
