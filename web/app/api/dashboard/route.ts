// GET /api/dashboard?meses=3|6|12 (con sesión) (de rutas/dashboard.js)
// En una sola llamada: estadísticas de la plataforma, gráficas, subastas en curso,
// pujas recientes y la actividad propia según el rol. Las consultas van en paralelo.
import { urlPublica } from "@/lib/config";
import { cerrarVencidasSiToca } from "@/lib/cierre-subastas";
import { obtenerPool } from "@/lib/db";
import { json, ruta } from "@/lib/http";
import { type Usuario, exigirSesion } from "@/lib/sesion";
import { redondearCalificacion } from "@/lib/utilidades";

const PERIODOS = [3, 6, 12];
const CAMPOS_DE_TEXTO = ["categoria", "departamento", "lote", "proveedor", "mes", "rol", "postor"];

type Fila = Record<string, unknown>;

// pg devuelve numeric y sum como texto: se convierten a número (menos los campos de texto)
const aNumeros = (o: Fila) =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [
      k,
      typeof v === "string" && v !== "" && !isNaN(Number(v)) && !CAMPOS_DE_TEXTO.includes(k) ? Number(v) : v,
    ])
  );

// Primer día del mes de inicio del periodo (ej. 6 meses = mes actual + 5 anteriores)
function inicioDelPeriodo(meses: number) {
  const inicio = new Date();
  inicio.setDate(1);
  inicio.setHours(0, 0, 0, 0);
  inicio.setMonth(inicio.getMonth() - (meses - 1));
  return inicio;
}

// Serie mes a mes (incluye los meses sin actividad, en 0)
function serieMensual(filas: Fila[], inicio: Date, meses: number) {
  const serie = [];
  for (let i = 0; i < meses; i++) {
    const f = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
    const clave = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
    const fila: Record<string, string | number> = { mes: clave, registros: 0, ofertas: 0, pujas: 0 };
    filas.filter((a) => a.mes === clave).forEach((a) => (fila[a.tipo as string] = Number(a.total)));
    serie.push(fila);
  }
  return serie;
}

const consulta = async (sql: string, params: unknown[] = []) => (await obtenerPool().query(sql, params)).rows as Fila[];

// ACTIVIDAD PROPIA SEGÚN EL ROL
async function actividadPropia(usuario: Usuario) {
  const yo = usuario.id;
  const mia: Fila = { rol: usuario.rol };
  if (usuario.rol === "proveedor") {
    const [m] = await consulta(
      `SELECT
         (SELECT count(*)::int FROM ofertas WHERE proveedor_id = $1) AS "misOfertas",
         (SELECT count(*)::int FROM subastas WHERE proveedor_id = $1 AND estado = 'Activa' AND fecha_fin > now()) AS "misSubastasActivas",
         (SELECT count(*)::int FROM pujas pj JOIN subastas s ON s.subasta_id = pj.subasta_id WHERE s.proveedor_id = $1) AS "pujasRecibidas",
         (SELECT COALESCE(sum(precio_actual), 0) FROM subastas WHERE proveedor_id = $1 AND estado = 'Activa' AND fecha_fin > now()) AS "valorMisSubastas",
         (SELECT count(*)::int FROM mensajes_chat WHERE destinatario_id = $1) AS "mensajesRecibidos",
         (SELECT count(*)::int FROM tratos_cerrados WHERE proveedor_id = $1 AND tipo_origen = 'Subasta' AND estado_trato <> 'Cancelado') AS "subastasVendidas",
         (SELECT COALESCE(sum(monto_total), 0) FROM tratos_cerrados WHERE proveedor_id = $1 AND tipo_origen = 'Subasta' AND estado_trato <> 'Cancelado') AS "montoVendido"`,
      [yo]
    );
    Object.assign(mia, m);
  } else if (usuario.rol === "emprendedor") {
    const [m] = await consulta(
      `SELECT
         (SELECT count(*)::int FROM pujas WHERE emprendedor_id = $1) AS "misPujas",
         (SELECT count(DISTINCT subasta_id)::int FROM pujas WHERE emprendedor_id = $1) AS "subastasParticipando",
         (SELECT count(*)::int FROM subastas s
            WHERE s.estado = 'Activa' AND s.fecha_fin > now()
              AND s.precio_actual = (SELECT max(monto_puja) FROM pujas WHERE subasta_id = s.subasta_id AND emprendedor_id = $1)) AS "subastasLiderando",
         (SELECT COALESCE(sum(s.precio_actual), 0) FROM subastas s
            WHERE s.estado = 'Activa' AND s.fecha_fin > now()
              AND s.precio_actual = (SELECT max(monto_puja) FROM pujas WHERE subasta_id = s.subasta_id AND emprendedor_id = $1)) AS "montoLiderando",
         (SELECT count(*)::int FROM mensajes_chat WHERE destinatario_id = $1) AS "mensajesRecibidos",
         (SELECT count(*)::int FROM tratos_cerrados WHERE emprendedor_id = $1 AND tipo_origen = 'Subasta' AND estado_trato <> 'Cancelado') AS "subastasGanadas",
         (SELECT COALESCE(sum(monto_total), 0) FROM tratos_cerrados WHERE emprendedor_id = $1 AND tipo_origen = 'Subasta' AND estado_trato <> 'Cancelado') AS "montoGanado"`,
      [yo]
    );
    Object.assign(mia, m);
  }
  // Calificación que me dieron en mis tratos completados
  if (usuario.rol === "proveedor" || usuario.rol === "emprendedor") {
    const [cal] = await consulta("SELECT count(*)::int AS total, avg(puntuacion) AS promedio FROM calificaciones WHERE calificado_id = $1", [yo]);
    mia.misCalificaciones = cal.total;
    mia.miCalificacion = redondearCalificacion(cal.promedio);
  }
  return mia;
}

export const GET = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  // Cierre perezoso: las subastas recién vencidas ya cuentan como cerradas y con su trato
  await cerrarVencidasSiToca(urlPublica(req), { esperar: true });
  const pedido = Number(new URL(req.url).searchParams.get("meses"));
  const meses = PERIODOS.includes(pedido) ? pedido : 6;
  const inicio = inicioDelPeriodo(meses);
  const yo = usuario.id;

  const [[resumen], categorias, departamentos, filasActividad, subastas, pujasRecientes, miActividad] = await Promise.all([
    consulta(`
      SELECT
        (SELECT count(*)::int FROM usuarios WHERE lower(tipo_rol) = 'proveedor') AS proveedores,
        (SELECT count(*)::int FROM usuarios WHERE lower(tipo_rol) = 'emprendedor') AS emprendedores,
        (SELECT count(*)::int FROM usuarios WHERE fecha_registro >= now() - interval '30 days') AS "nuevosUsuarios30d",
        (SELECT count(*)::int FROM ofertas) AS ofertas,
        (SELECT count(*)::int FROM ofertas WHERE fecha_publicacion >= now() - interval '30 days') AS "ofertas30d",
        (SELECT COALESCE(avg(precio), 0) FROM ofertas) AS "precioPromedio",
        (SELECT count(*)::int FROM subastas WHERE estado = 'Activa' AND fecha_fin > now()) AS "subastasActivas",
        (SELECT count(*)::int FROM subastas WHERE estado = 'Finalizada' OR (estado = 'Activa' AND fecha_fin <= now())) AS "subastasCerradas",
        (SELECT COALESCE(sum(precio_actual), 0) FROM subastas WHERE estado = 'Activa' AND fecha_fin > now()) AS "valorEnSubasta",
        (SELECT count(*)::int FROM pujas) AS pujas,
        (SELECT count(*)::int FROM pujas WHERE fecha_puja >= now() - interval '30 days') AS "pujas30d",
        (SELECT count(*)::int FROM mensajes_chat) AS mensajes,
        (SELECT count(*)::int FROM mensajes_chat WHERE fecha_envio >= now() - interval '30 days') AS "mensajes30d"`),
    consulta(`
      SELECT c.nombre_categoria AS categoria,
             count(o.oferta_id)::int AS ofertas,
             COALESCE(avg(o.precio), 0) AS "precioPromedio",
             COALESCE(min(o.precio), 0) AS "precioMinimo",
             COALESCE(max(o.precio), 0) AS "precioMaximo"
      FROM categorias_materiales c
      JOIN ofertas o ON o.categoria_id = c.categoria_id
      GROUP BY c.categoria_id, c.nombre_categoria
      ORDER BY ofertas DESC, categoria`),
    consulta(`
      SELECT d.nombre_departamento AS departamento,
             count(*) FILTER (WHERE lower(u.tipo_rol) = 'proveedor')::int AS proveedores,
             count(*) FILTER (WHERE lower(u.tipo_rol) = 'emprendedor')::int AS emprendedores
      FROM perfiles_usuarios p
      JOIN usuarios u ON u.usuario_id = p.usuario_id
      JOIN departamentos d ON d.departamento_id = p.departamento_id
      WHERE lower(u.tipo_rol) IN ('proveedor', 'emprendedor')
      GROUP BY d.departamento_id, d.nombre_departamento
      ORDER BY count(*) DESC, departamento`),
    consulta(
      `SELECT 'registros' AS tipo, to_char(fecha_registro, 'YYYY-MM') AS mes, count(*)::int AS total
         FROM usuarios WHERE fecha_registro >= $1 GROUP BY 2
       UNION ALL
       SELECT 'ofertas', to_char(fecha_publicacion, 'YYYY-MM'), count(*)::int
         FROM ofertas WHERE fecha_publicacion >= $1 GROUP BY 2
       UNION ALL
       SELECT 'pujas', to_char(fecha_puja, 'YYYY-MM'), count(*)::int
         FROM pujas WHERE fecha_puja >= $1 GROUP BY 2`,
      [inicio]
    ),
    consulta(
      `SELECT s.subasta_id AS id, s.titulo_lote AS lote,
              COALESCE(pr.nombre_razon_social, 'Proveedor') AS proveedor,
              s.precio_base AS "precioBase", s.precio_actual AS "precioActual",
              s.fecha_fin AS "fechaFin", count(pj.puja_id)::int AS pujas,
              (s.proveedor_id = $1) AS "esMia"
       FROM subastas s
       LEFT JOIN pujas pj ON pj.subasta_id = s.subasta_id
       LEFT JOIN perfiles_usuarios pr ON pr.usuario_id = s.proveedor_id
       WHERE s.estado = 'Activa' AND s.fecha_fin > now()
       GROUP BY s.subasta_id, pr.nombre_razon_social
       ORDER BY pujas DESC, s.fecha_fin ASC
       LIMIT 100`,
      [yo]
    ),
    // Los nombres de los postores solo los ve el administrador
    consulta(
      `SELECT pj.monto_puja AS monto, pj.fecha_puja AS fecha, s.titulo_lote AS lote,
              ${usuario.esAdmin ? "COALESCE(pe.nombre_razon_social, 'Emprendedor')" : "NULL"} AS postor,
              (pj.emprendedor_id = $1) AS "esMia"
       FROM pujas pj
       JOIN subastas s ON s.subasta_id = pj.subasta_id
       LEFT JOIN perfiles_usuarios pe ON pe.usuario_id = pj.emprendedor_id
       ORDER BY pj.fecha_puja DESC, pj.puja_id DESC
       LIMIT 15`,
      [yo]
    ),
    actividadPropia(usuario),
  ]);

  return json({
    generado: new Date().toISOString(),
    periodoMeses: meses,
    esAdmin: usuario.esAdmin,
    resumen: aNumeros(resumen),
    categorias: categorias.map(aNumeros),
    departamentos: departamentos.map(aNumeros),
    actividad: serieMensual(filasActividad, inicio, meses),
    subastas: subastas.map((s) => ({ ...aNumeros(s), esMia: !!s.esMia })),
    pujasRecientes: pujasRecientes.map((p) => ({ ...aNumeros(p), esMia: !!p.esMia })),
    miActividad: aNumeros(miActividad),
  });
});
