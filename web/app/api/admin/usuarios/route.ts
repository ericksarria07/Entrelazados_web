// GET /api/admin/usuarios (de rutas/admin.js)
// ?buscar=texto (nombre o correo, sin acentos ni mayúsculas), ?problemas=1 (correo inválido
// o sin confirmar), ?pagina=N&porPagina=M para paginar (sin ?pagina devuelve la lista completa).
import { obtenerPool } from "@/lib/db";
import { json, ruta } from "@/lib/http";
import { exigirAdmin } from "@/lib/sesion";
import { REGEX_EMAIL, REGEXP_EMAIL_SQL, leerPaginacion, patronLike, respuestaPaginada } from "@/lib/utilidades";

export const GET = ruta(async (req) => {
  await exigirAdmin(req);
  const query = new URL(req.url).searchParams;
  const pag = leerPaginacion(query, 20, 100);
  const condiciones: string[] = [];
  const params: unknown[] = [];
  const p = (valor: unknown) => `$${params.push(valor)}`;
  const buscar = query.get("buscar");
  if (buscar && buscar.trim()) {
    const patron = p(patronLike(buscar));
    condiciones.push(`(unaccent(u.correo_electronico) ILIKE unaccent(${patron}) OR unaccent(p.nombre_razon_social) ILIKE unaccent(${patron}))`);
  }
  if (query.get("problemas") === "1") condiciones.push(`(u.correo_verificado = false OR u.correo_electronico !~ ${p(REGEXP_EMAIL_SQL)})`);
  const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";
  const desde = `
    FROM usuarios u
    LEFT JOIN perfiles_usuarios p ON u.usuario_id = p.usuario_id
    LEFT JOIN departamentos d ON p.departamento_id = d.departamento_id
    ${where}`;
  const paramsFiltro = [...params];
  const limite = pag ? `LIMIT ${p(pag.porPagina)} OFFSET ${p(pag.offset)}` : "";

  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT u.usuario_id AS "UsuarioID", u.correo_electronico AS "CorreoElectronico", u.tipo_rol AS "TipoRol",
            COALESCE(u.estado_cuenta, 'Activo') AS "EstadoCuenta", u.fecha_registro AS "FechaCreacion",
            u.correo_verificado AS "CorreoVerificado", p.nombre_razon_social AS "NombreRazonSocial",
            p.telefono_whatsapp AS "TelefonoWhatsApp", d.nombre_departamento AS "NombreDepartamento"
     ${desde}
     ORDER BY u.usuario_id DESC
     ${limite}`,
    params
  );
  // CorreoValido = false: el correo no tiene dominio completo (p. ej. "erick@gmail") y no puede iniciar sesión
  const lista = rows.map((u) => ({ ...u, CorreoVerificado: !!u.CorreoVerificado, CorreoValido: REGEX_EMAIL.test(u.CorreoElectronico || "") }));
  if (!pag) return json(lista);
  const {
    rows: [{ total }],
  } = await pool.query(`SELECT count(*)::int AS total ${desde}`, paramsFiltro);
  return json(respuestaPaginada(lista, total, pag));
});
