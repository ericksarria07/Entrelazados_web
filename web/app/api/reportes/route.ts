// GET /api/reportes?meses=3|6|12 (con sesión; lo usa /reportes) (de rutas/reportes.js)
//
// Lo que cada quien ve:
//   administrador  → toda la plataforma
//   proveedor      → sus ventas (sus subastas y sus tratos)
//   emprendedor    → sus compras (las subastas donde pujó y sus tratos)
// Los precios por categoría son del mercado completo (son públicos).
// Responde en una sola llamada (las consultas van en paralelo).
import { obtenerPool } from "@/lib/db";
import { json, ruta } from "@/lib/http";
import { inicioDelPeriodo, leerMeses, mesesDelPeriodo } from "@/lib/periodos";
import { type Usuario, exigirSesion } from "@/lib/sesion";

const ESTADO_SUBASTA = `
  CASE WHEN s.estado = 'Cancelada' THEN 'Canceladas'
       WHEN s.estado = 'Activa' AND s.fecha_fin > now() THEN 'En curso'
       WHEN (SELECT count(*) FROM pujas px WHERE px.subasta_id = s.subasta_id) > 0 THEN 'Con ganador'
       ELSE 'Sin pujas' END`;

type Fila = Record<string, unknown>;
const num = (v: unknown) => Number(v) || 0;
const redondear = (v: unknown, decimales = 2) => Math.round(num(v) * 10 ** decimales) / 10 ** decimales;

// Filtros SQL según el rol de quien pide el reporte ($1 es siempre el usuario, si se usa)
function alcanceDe(usuario: Usuario) {
  if (usuario.esAdmin) return { nombre: "plataforma", conUsuario: false, tratos: "true", subastas: "true", pujas: "true" };
  if (usuario.rol === "proveedor") {
    return { nombre: "ventas", conUsuario: true, tratos: "t.proveedor_id = $1", subastas: "s.proveedor_id = $1", pujas: "s.proveedor_id = $1" };
  }
  return {
    nombre: "compras",
    conUsuario: true,
    tratos: "t.emprendedor_id = $1",
    subastas: "s.subasta_id IN (SELECT subasta_id FROM pujas WHERE emprendedor_id = $1)",
    pujas: "p.emprendedor_id = $1",
  };
}

export const GET = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  const meses = leerMeses(new URL(req.url).searchParams.get("meses"));
  const inicio = inicioDelPeriodo(meses);
  const claves = mesesDelPeriodo(inicio, meses);
  const alcance = alcanceDe(usuario);
  // Parámetros: [usuario, inicio] si el filtro usa al usuario; si no, solo [inicio] ($1)
  const params = alcance.conUsuario ? [usuario.id, inicio] : [inicio];
  const fechaDesde = alcance.conUsuario ? "$2" : "$1";
  const pool = obtenerPool();
  const consulta = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows as Fila[];

  const [tratosMes, estados, categorias, lotes, topCategorias, tratos] = await Promise.all([
    consulta(
      `SELECT to_char(t.fecha_cierre, 'YYYY-MM') AS mes,
              count(*)::int AS tratos,
              count(*) FILTER (WHERE t.estado_trato = 'Completado')::int AS completados,
              count(*) FILTER (WHERE t.estado_trato = 'Cancelado')::int AS cancelados,
              COALESCE(sum(CASE WHEN t.estado_trato = 'Completado' THEN t.monto_total ELSE 0 END), 0) AS "montoCompletado",
              COALESCE(sum(CASE WHEN t.estado_trato <> 'Cancelado' THEN t.monto_total ELSE 0 END), 0) AS monto
       FROM tratos_cerrados t
       WHERE ${alcance.tratos} AND t.fecha_cierre >= ${fechaDesde}
       GROUP BY 1`,
      params
    ),
    consulta(
      `SELECT x.estado, count(*)::int AS total
       FROM (SELECT ${ESTADO_SUBASTA} AS estado FROM subastas s WHERE ${alcance.subastas} AND s.fecha_inicio >= ${fechaDesde}) x
       GROUP BY x.estado`,
      params
    ),
    consulta(
      `SELECT COALESCE(c.nombre_categoria, 'Sin categoría') AS categoria,
              count(p.puja_id)::int AS pujas,
              count(DISTINCT p.subasta_id)::int AS subastas,
              COALESCE(max(p.monto_puja), 0) AS "pujaMaxima"
       FROM pujas p
       JOIN subastas s ON s.subasta_id = p.subasta_id
       LEFT JOIN categorias_materiales c ON c.categoria_id = s.categoria_id
       WHERE ${alcance.pujas} AND p.fecha_puja >= ${fechaDesde}
       GROUP BY s.categoria_id, c.nombre_categoria
       ORDER BY pujas DESC, categoria
       LIMIT 10`,
      params
    ),
    consulta(
      `SELECT * FROM (
         SELECT s.subasta_id AS id, s.titulo_lote AS lote,
                COALESCE(c.nombre_categoria, 'Sin categoría') AS categoria,
                s.precio_base AS "precioBase", s.precio_actual AS "precioFinal",
                ${ESTADO_SUBASTA} AS estado,
                (SELECT count(*)::int FROM pujas p WHERE p.subasta_id = s.subasta_id) AS pujas
         FROM subastas s
         LEFT JOIN categorias_materiales c ON c.categoria_id = s.categoria_id
         WHERE ${alcance.subastas} AND s.fecha_inicio >= ${fechaDesde}
       ) l
       WHERE l.pujas > 0
       ORDER BY l.pujas DESC, l."precioFinal" DESC
       LIMIT 10`,
      params
    ),
    // Mercado completo: las 5 categorías con más lotes en el periodo
    consulta(
      `SELECT s.categoria_id AS id, c.nombre_categoria AS categoria, count(*)::int AS lotes
       FROM subastas s JOIN categorias_materiales c ON c.categoria_id = s.categoria_id
       WHERE s.fecha_inicio >= $1
       GROUP BY s.categoria_id, c.nombre_categoria
       ORDER BY lotes DESC, categoria
       LIMIT 5`,
      [inicio]
    ),
    consulta(
      `SELECT t.trato_id AS id, t.fecha_cierre AS fecha, t.descripcion_resumen AS descripcion,
              t.monto_total AS monto, t.estado_trato AS estado,
              COALESCE(pp.nombre_razon_social, 'Proveedor') AS proveedor,
              COALESCE(pe.nombre_razon_social, 'Emprendedor') AS comprador
       FROM tratos_cerrados t
       LEFT JOIN perfiles_usuarios pp ON pp.usuario_id = t.proveedor_id
       LEFT JOIN perfiles_usuarios pe ON pe.usuario_id = t.emprendedor_id
       WHERE ${alcance.tratos} AND t.fecha_cierre >= ${fechaDesde}
       ORDER BY t.fecha_cierre DESC, t.trato_id DESC
       LIMIT 200`,
      params
    ),
  ]);

  // Precio base promedio por mes de las categorías principales
  const idsTop = topCategorias.map((c) => c.id);
  const precios = idsTop.length
    ? await consulta(
        `SELECT s.categoria_id AS id, to_char(s.fecha_inicio, 'YYYY-MM') AS mes, avg(s.precio_base) AS promedio
         FROM subastas s
         WHERE s.fecha_inicio >= $1 AND s.categoria_id = ANY($2)
         GROUP BY 1, 2`,
        [inicio, idsTop]
      )
    : [];

  // ---- Armar la respuesta
  const ventasPorMes = claves.map((mes) => {
    const f = tratosMes.find((x) => x.mes === mes) || {};
    return {
      mes,
      tratos: num(f.tratos),
      completados: num(f.completados),
      cancelados: num(f.cancelados),
      monto: redondear(f.monto),
      montoCompletado: redondear(f.montoCompletado),
    };
  });

  const estadoSubastas = ["Con ganador", "Sin pujas", "Canceladas", "En curso"].map((estado) => ({
    estado,
    total: num((estados.find((e) => e.estado === estado) || {}).total),
  }));
  const porEstado = Object.fromEntries(estadoSubastas.map((e) => [e.estado, e.total]));
  const terminadas = porEstado["Con ganador"] + porEstado["Sin pujas"];

  const totalTratos = ventasPorMes.reduce((t, m) => t + m.tratos, 0);
  const cancelados = ventasPorMes.reduce((t, m) => t + m.cancelados, 0);
  const completados = ventasPorMes.reduce((t, m) => t + m.completados, 0);
  const monto = redondear(ventasPorMes.reduce((t, m) => t + m.monto, 0));
  const vigentes = totalTratos - cancelados;

  return json({
    generado: new Date().toISOString(),
    periodoMeses: meses,
    desde: inicio.toISOString(),
    alcance: alcance.nombre,
    resumen: {
      tratos: totalTratos,
      completados,
      enCurso: vigentes - completados,
      cancelados,
      monto,
      montoCompletado: redondear(ventasPorMes.reduce((t, m) => t + m.montoCompletado, 0)),
      ticketPromedio: vigentes ? redondear(monto / vigentes) : 0,
      subastas: estadoSubastas.reduce((t, e) => t + e.total, 0),
      tasaExito: terminadas ? redondear(porEstado["Con ganador"] / terminadas, 4) : null,
    },
    ventasPorMes,
    estadoSubastas,
    materialesMasPedidos: categorias.map((c) => ({
      categoria: c.categoria,
      pujas: num(c.pujas),
      subastas: num(c.subastas),
      pujaMaxima: redondear(c.pujaMaxima),
    })),
    lotesMasDisputados: lotes.map((l) => ({
      id: l.id,
      lote: String(l.lote || "").replace(/^Lote Subasta:\s*/i, ""),
      categoria: l.categoria,
      pujas: num(l.pujas),
      precioBase: redondear(l.precioBase),
      precioFinal: redondear(l.precioFinal),
      incremento: num(l.precioBase) > 0 ? redondear((num(l.precioFinal) - num(l.precioBase)) / num(l.precioBase), 4) : 0,
      estado: l.estado,
    })),
    preciosPorCategoria: {
      meses: claves,
      series: topCategorias.map((c) => ({
        categoria: c.categoria,
        lotes: num(c.lotes),
        valores: claves.map((mes) => {
          const f = precios.find((p) => p.id === c.id && p.mes === mes);
          return f ? redondear(f.promedio) : null;
        }),
      })),
    },
    tratos: tratos.map((t) => ({
      id: t.id,
      fecha: t.fecha,
      lote: String(t.descripcion || "")
        .replace(/^Subasta ganada:\s*/i, "")
        .replace(/^Lote Subasta:\s*/i, ""),
      monto: redondear(t.monto),
      estado: t.estado,
      proveedor: t.proveedor,
      comprador: t.comprador,
    })),
  });
});
