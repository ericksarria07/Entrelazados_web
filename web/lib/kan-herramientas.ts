// ==========================================================================
// HERRAMIENTAS DE KAN (tool calling del Vercel AI SDK)
//
// En vez de meter todo el mercado en el mensaje, Kan pide solo lo que necesita:
//   * buscarOfertas      publicaciones por texto y/o categoría
//   * subastasActivas    subastas abiertas, las que cierran antes primero
//   * misSubastas        las del usuario de la sesión: las suyas si es proveedor,
//                        o en las que pujó si es emprendedor
//   * preciosDeReferencia mínimo, mediana y máximo de una categoría (y unidad)
//
// Solo leen, y solo datos públicos del mercado más lo del propio usuario: el id y el
// rol salen de la sesión, nunca de lo que escriba el usuario o la IA. Si una consulta
// falla, la herramienta devuelve { error } y Kan contesta con lo que tenga.
// ==========================================================================
import { tool } from "ai";
import { z } from "zod";
import { obtenerPool } from "@/lib/db";
import type { Usuario } from "@/lib/sesion";
import { tiempoRestante } from "@/lib/kan-respuestas";
import { estadisticas, normalizarUnidad } from "@/lib/reglas-precio";
import { patronLike } from "@/lib/utilidades";

const MAXIMO_FILAS = 8;
const precio = (n: unknown) => Math.round(Number(n) * 100) / 100;

async function conRespaldo<T>(nombre: string, consulta: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await consulta();
  } catch (error) {
    console.error(`❌ Kan (${nombre}):`, (error as Error)?.message || error);
    return { error: "No se pudo consultar la base de datos en este momento." };
  }
}

// Nombres de las categorías, para que la IA sepa qué puede pedir (van en las instrucciones)
export async function nombresDeCategorias(): Promise<string[]> {
  try {
    const { rows } = await obtenerPool().query<{ nombre_categoria: string }>(
      "SELECT nombre_categoria FROM categorias_materiales ORDER BY nombre_categoria",
    );
    return rows.map((r) => r.nombre_categoria);
  } catch {
    return [];
  }
}

export function herramientasDeKan(usuario: Pick<Usuario, "id" | "rol">) {
  const rol = usuario.rol.toLowerCase();
  return {
    buscarOfertas: tool({
      description:
        "Busca publicaciones de materiales en venta en el mercado de EntreLazados. Úsala cuando pregunten qué hay, precios o quién vende algo.",
      inputSchema: z.object({
        texto: z.string().max(100).optional().describe("Palabras a buscar en el título o la descripción, por ejemplo 'cuero vacuno'"),
        categoria: z.string().max(50).optional().describe("Nombre de la categoría, tal como aparece en la lista de categorías"),
      }),
      execute: ({ texto, categoria }) =>
        conRespaldo("buscarOfertas", async () => {
          const params: unknown[] = [];
          const p = (v: unknown) => `$${params.push(v)}`;
          const condiciones: string[] = [];
          if (texto?.trim()) {
            const patron = p(patronLike(texto));
            condiciones.push(`(unaccent(o.titulo_material) ILIKE unaccent(${patron}) OR unaccent(o.descripcion) ILIKE unaccent(${patron}))`);
          }
          if (categoria?.trim()) condiciones.push(`unaccent(c.nombre_categoria) ILIKE unaccent(${p(patronLike(categoria))})`);
          const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
          const { rows } = await obtenerPool().query(
            `SELECT o.titulo_material, o.precio, o.unidad_medida, c.nombre_categoria,
                    COALESCE(pr.nombre_razon_social, 'Proveedor') AS proveedor
             FROM ofertas o
             JOIN categorias_materiales c ON c.categoria_id = o.categoria_id
             LEFT JOIN perfiles_usuarios pr ON pr.usuario_id = o.proveedor_id
             ${where}
             ORDER BY o.fecha_publicacion DESC, o.oferta_id DESC
             LIMIT ${MAXIMO_FILAS}`,
            params,
          );
          return {
            encontradas: rows.length,
            ofertas: rows.map((o) => ({
              titulo: o.titulo_material,
              categoria: o.nombre_categoria,
              precio: precio(o.precio),
              unidad: o.unidad_medida,
              proveedor: o.proveedor,
            })),
          };
        }),
    }),

    subastasActivas: tool({
      description: "Lista las subastas abiertas (las que cierran antes primero), con la puja actual y cuánto falta para que cierren.",
      inputSchema: z.object({
        texto: z.string().max(100).optional().describe("Palabras a buscar en el nombre del lote"),
      }),
      execute: ({ texto }) =>
        conRespaldo("subastasActivas", async () => {
          const params: unknown[] = [];
          const filtro = texto?.trim() ? `AND unaccent(s.titulo_lote) ILIKE unaccent($${params.push(patronLike(texto))})` : "";
          const { rows } = await obtenerPool().query(
            `SELECT s.titulo_lote, s.precio_base, s.precio_actual, s.fecha_fin,
                    (SELECT count(*)::int FROM pujas p WHERE p.subasta_id = s.subasta_id) AS pujas
             FROM subastas s
             WHERE s.estado = 'Activa' AND s.fecha_fin > now() ${filtro}
             ORDER BY s.fecha_fin, s.subasta_id
             LIMIT ${MAXIMO_FILAS}`,
            params,
          );
          return {
            encontradas: rows.length,
            subastas: rows.map((s) => ({
              lote: s.titulo_lote,
              precioBase: precio(s.precio_base),
              pujaActual: precio(s.precio_actual),
              pujas: s.pujas,
              cierraEn: tiempoRestante(new Date(s.fecha_fin)),
            })),
          };
        }),
    }),

    misSubastas: tool({
      description:
        "Las subastas del usuario que pregunta: si es proveedor, las que abrió; si es emprendedor, en las que pujó y si va ganando.",
      inputSchema: z.object({}),
      execute: () =>
        conRespaldo("misSubastas", async () => {
          const pool = obtenerPool();
          if (rol === "proveedor") {
            const { rows } = await pool.query(
              `SELECT s.titulo_lote, s.precio_actual, s.fecha_fin, s.estado,
                      (SELECT count(*)::int FROM pujas p WHERE p.subasta_id = s.subasta_id) AS pujas
               FROM subastas s WHERE s.proveedor_id = $1
               ORDER BY (s.estado = 'Activa') DESC, s.fecha_fin DESC LIMIT ${MAXIMO_FILAS}`,
              [usuario.id],
            );
            return {
              rol: "proveedor",
              subastas: rows.map((s) => ({
                lote: s.titulo_lote,
                estado: s.estado,
                pujaActual: precio(s.precio_actual),
                pujas: s.pujas,
                ...(s.estado === "Activa" ? { cierraEn: tiempoRestante(new Date(s.fecha_fin)) } : {}),
              })),
            };
          }
          if (rol === "emprendedor") {
            const { rows } = await pool.query(
              `SELECT s.titulo_lote, s.precio_actual, s.fecha_fin, s.estado, max(p.monto_puja) AS mi_puja,
                      (SELECT p2.emprendedor_id FROM pujas p2 WHERE p2.subasta_id = s.subasta_id
                       ORDER BY p2.monto_puja DESC, p2.fecha_puja LIMIT 1) = $1 AS voy_ganando
               FROM pujas p JOIN subastas s ON s.subasta_id = p.subasta_id
               WHERE p.emprendedor_id = $1
               GROUP BY s.subasta_id
               ORDER BY (s.estado = 'Activa') DESC, s.fecha_fin DESC LIMIT ${MAXIMO_FILAS}`,
              [usuario.id],
            );
            return {
              rol: "emprendedor",
              subastas: rows.map((s) => ({
                lote: s.titulo_lote,
                estado: s.estado,
                miPujaMasAlta: precio(s.mi_puja),
                pujaActual: precio(s.precio_actual),
                [s.estado === "Activa" ? "voyGanando" : "gane"]: Boolean(s.voy_ganando),
                ...(s.estado === "Activa" ? { cierraEn: tiempoRestante(new Date(s.fecha_fin)) } : {}),
              })),
            };
          }
          return { rol, subastas: [], nota: "Los administradores no abren subastas ni pujan." };
        }),
    }),

    preciosDeReferencia: tool({
      description:
        "Precio mínimo, mediana y máximo de las publicaciones de una categoría (y, si se indica, de una unidad de medida). Úsala para decir si un precio es caro o barato.",
      inputSchema: z.object({
        categoria: z.string().min(1).max(50).describe("Nombre de la categoría, tal como aparece en la lista de categorías"),
        unidad: z.string().max(30).optional().describe("Unidad de medida, por ejemplo 'metro', 'kg' o 'pie cuadrado'"),
      }),
      execute: ({ categoria, unidad }) =>
        conRespaldo("preciosDeReferencia", async () => {
          const { rows } = await obtenerPool().query(
            `SELECT c.nombre_categoria, o.precio, o.unidad_medida
             FROM ofertas o JOIN categorias_materiales c ON c.categoria_id = o.categoria_id
             WHERE unaccent(c.nombre_categoria) ILIKE unaccent($1)
             ORDER BY o.fecha_publicacion DESC LIMIT 200`,
            [patronLike(categoria)],
          );
          const miUnidad = unidad ? normalizarUnidad(unidad) : "";
          const filas = miUnidad ? rows.filter((r) => normalizarUnidad(r.unidad_medida) === miUnidad) : rows;
          const est = estadisticas(filas.map((r) => r.precio));
          if (!est) return { categoria, unidad: unidad ?? null, muestras: 0 };
          return { categoria: rows[0].nombre_categoria, unidad: unidad ?? "todas", ...est };
        }),
    }),
  };
}
