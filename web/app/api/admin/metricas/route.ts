// GET /api/admin/metricas: contadores de la plataforma para el panel de administrador.
// Las demás rutas de backend/entrelazados-api/rutas/admin.js llegan en su propia rama.
import { obtenerPool } from "@/lib/db";
import { json, ruta } from "@/lib/http";
import { exigirAdmin } from "@/lib/sesion";
import { REGEXP_EMAIL_SQL } from "@/lib/utilidades";

export const GET = ruta(async (req) => {
  await exigirAdmin(req);
  // count(*) llega como texto en Postgres: ::int para responder números, como MySQL
  const {
    rows: [metricas],
  } = await obtenerPool().query(
    `SELECT
       (SELECT count(*)::int FROM usuarios) AS "totalUsuarios",
       (SELECT count(*)::int FROM usuarios WHERE lower(tipo_rol) = 'proveedor') AS "totalProveedores",
       (SELECT count(*)::int FROM usuarios WHERE lower(tipo_rol) = 'emprendedor') AS "totalEmprendedores",
       (SELECT count(*)::int FROM usuarios WHERE lower(tipo_rol) IN ('administrador', 'admin')) AS "totalAdmins",
       (SELECT count(*)::int FROM ofertas) AS "totalOfertas",
       (SELECT count(*)::int FROM subastas WHERE estado = 'Activa') AS "subastasActivas",
       (SELECT count(*)::int FROM mensajes_chat) AS "totalMensajes",
       (SELECT count(*)::int FROM usuarios WHERE correo_electronico !~ $1) AS "correosInvalidos",
       (SELECT count(*)::int FROM usuarios WHERE correo_verificado = false) AS "cuentasSinVerificar"`,
    [REGEXP_EMAIL_SQL]
  );
  return json(metricas ?? {});
});
