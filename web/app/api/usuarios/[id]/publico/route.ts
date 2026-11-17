// GET /api/usuarios/[id]/publico: perfil PÚBLICO (sin sesión), lo que se puede compartir
import { obtenerPool } from "@/lib/db";
import { json, ruta } from "@/lib/http";
import { usuarioPublico } from "@/lib/usuarios";
import { redondearCalificacion } from "@/lib/utilidades";

export const GET = ruta<RouteContext<"/api/usuarios/[id]/publico">>(async (_req, ctx) => {
  const u = await usuarioPublico((await ctx.params).id);
  const id = u.usuario_id;
  const esProveedor = u.tipo_rol.toLowerCase() === "proveedor";
  const pool = obtenerPool();
  const [
    {
      rows: [cuentas],
    },
    { rows: estrellas },
  ] = await Promise.all([
    pool.query(
      `SELECT (SELECT count(*)::int FROM ofertas WHERE proveedor_id = $1) AS publicaciones,
              (SELECT count(*)::int FROM subastas WHERE proveedor_id = $1 AND estado = 'Activa' AND fecha_fin > now()) AS "subastasActivas",
              (SELECT count(*)::int FROM tratos_cerrados
                WHERE (proveedor_id = $1 OR emprendedor_id = $1) AND estado_trato = 'Completado') AS "tratosCompletados"`,
      [id]
    ),
    pool.query<{ puntuacion: number; total: number }>(
      "SELECT puntuacion, count(*)::int AS total FROM calificaciones WHERE calificado_id = $1 GROUP BY puntuacion",
      [id]
    ),
  ]);
  // Cuántas calificaciones hay de cada estrella (5 a 1), para las barras de la página
  const distribucion: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let total = 0;
  let suma = 0;
  for (const e of estrellas) {
    distribucion[e.puntuacion] = e.total;
    total += e.total;
    suma += e.total * e.puntuacion;
  }
  return json({
    id,
    rol: esProveedor ? "Proveedor" : "Emprendedor",
    nombre: u.nombre_razon_social || "Usuario",
    departamento: u.nombre_departamento || null,
    miembroDesde: u.fecha_registro,
    // Proveedor: nombre comercial, qué vende y la descripción de su empresa
    nombreComercial: esProveedor ? u.nombre_comercial || null : null,
    materiaPrincipal: esProveedor ? u.tipo_materia_prima_principal || null : null,
    descripcion: esProveedor ? u.descripcion_empresa || null : null,
    // Emprendedor: su marca y qué calzado hace
    marca: esProveedor ? null : u.nombre_marca || null,
    especialidad: esProveedor ? null : u.especialidad_calzado || null,
    estadisticas: {
      publicaciones: esProveedor ? cuentas.publicaciones : 0,
      subastasActivas: esProveedor ? cuentas.subastasActivas : 0,
      tratosCompletados: cuentas.tratosCompletados,
    },
    reputacion: { total, promedio: total ? redondearCalificacion(suma / total) : null, distribucion },
  });
});
