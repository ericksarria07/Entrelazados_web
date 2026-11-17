// GET /api/estadisticas: contadores de la página de inicio (de rutas/publicas.js)
import { obtenerPool } from "@/lib/db";
import { conRespaldo, json } from "@/lib/http";

export const GET = conRespaldo({ proveedores: 0, emprendedores: 0, subastas: 0 }, async () => {
  const {
    rows: [conteo],
  } = await obtenerPool().query(`
    SELECT
      (SELECT count(*)::int FROM usuarios WHERE lower(tipo_rol) = 'proveedor') AS proveedores,
      (SELECT count(*)::int FROM usuarios WHERE lower(tipo_rol) = 'emprendedor') AS emprendedores,
      (SELECT count(*)::int FROM subastas WHERE estado = 'Activa') AS subastas`);
  return json(conteo);
});
