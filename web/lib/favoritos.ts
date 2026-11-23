// ==========================================================================
// FAVORITOS Y ALERTAS DE BÚSQUEDA (equivale a servicios/favoritos.js)
//
// FAVORITOS: cualquier usuario guarda publicaciones con el corazón (menos las
// suyas). Si una publicación guardada baja de precio, quien la guardó recibe
// una notificación ("FavoritoRebajado").
//
// ALERTAS: "avísame cuando publiquen <palabra> en <categoría> por menos de
// C$<precio>". Cada campo es opcional, pero hace falta la palabra o la categoría.
// Cuando un proveedor publica algo que cumple, la persona recibe una notificación
// en la campana y un correo ("AlertaBusqueda").
//
// Los avisos salen DESPUÉS de responder (after) y nunca hacen fallar la publicación.
// ==========================================================================
import { after } from "next/server";
import { obtenerPool } from "@/lib/db";
import { ErrorHttp } from "@/lib/http";
import { enviarNotificaciones } from "@/lib/notificaciones";
import { urlsDeFotos } from "@/lib/ofertas";
import { type Paginacion, cordobas, enteroPositivo, redondearCalificacion, respuestaPaginada } from "@/lib/utilidades";

export const MAX_ALERTAS = 10;
// Las reglas puras de las alertas (validar, cumplir, describir) viven en alertas.ts,
// sin base de datos, para las pruebas unitarias
import { type Alerta, type OfertaParaAvisos, cumpleAlerta, describirAlerta, validarAlerta } from "@/lib/alertas";
export { cumpleAlerta, describirAlerta, normalizar, validarAlerta, type OfertaParaAvisos } from "@/lib/alertas";

// ---------------------------------------------------------------- FAVORITOS
export async function idsFavoritos(usuarioId: number): Promise<number[]> {
  const { rows } = await obtenerPool().query<{ oferta_id: number }>("SELECT oferta_id FROM favoritos WHERE usuario_id = $1", [usuarioId]);
  return rows.map((f) => f.oferta_id);
}

// Publicaciones guardadas, con los mismos campos que GET /api/ofertas.
// Con pag responde paginado; sin pag, hasta 100.
export async function listarFavoritos(usuarioId: number, pag: Paginacion | null) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT o.oferta_id AS "OfertaID", o.proveedor_id AS "ProveedorID", o.titulo_material AS "TituloMaterial",
            o.descripcion AS "Descripcion", o.precio AS "Precio", o.unidad_medida AS "UnidadMedida",
            o.distancia_simulada_km AS "DistanciaSimuladaKm", o.categoria_id AS "CategoriaID",
            c.nombre_categoria AS "NombreCategoria", o.fecha_publicacion AS "FechaPublicacion", f.fecha_guardado AS "FechaGuardado",
            COALESCE(pr.nombre_razon_social, 'Proveedor') AS "NombreProveedor",
            cal.promedio AS "CalificacionProveedor", COALESCE(cal.total, 0) AS "TotalCalificaciones"
     FROM favoritos f
     JOIN ofertas o ON o.oferta_id = f.oferta_id
     JOIN categorias_materiales c ON c.categoria_id = o.categoria_id
     LEFT JOIN perfiles_usuarios pr ON pr.usuario_id = o.proveedor_id
     LEFT JOIN (SELECT calificado_id, avg(puntuacion) AS promedio, count(*)::int AS total
                FROM calificaciones GROUP BY calificado_id) cal ON cal.calificado_id = o.proveedor_id
     WHERE f.usuario_id = $1
     ORDER BY f.fecha_guardado DESC, o.oferta_id DESC
     LIMIT $2 OFFSET $3`,
    [usuarioId, pag ? pag.porPagina : 100, pag ? pag.offset : 0]
  );
  const fotos = await urlsDeFotos(rows.map((o) => o.OfertaID));
  const lista = rows.map((o) => ({
    ...o,
    Fotos: fotos.get(o.OfertaID) || [],
    CalificacionProveedor: redondearCalificacion(o.CalificacionProveedor),
    TotalCalificaciones: Number(o.TotalCalificaciones),
  }));
  if (!pag) return lista;
  const {
    rows: [{ total }],
  } = await pool.query("SELECT count(*)::int AS total FROM favoritos WHERE usuario_id = $1", [usuarioId]);
  return respuestaPaginada(lista, total, pag);
}

export async function agregarFavorito(usuarioId: number, ofertaId: unknown) {
  const id = enteroPositivo(ofertaId);
  const pool = obtenerPool();
  const oferta = id
    ? (await pool.query<{ oferta_id: number; proveedor_id: number }>("SELECT oferta_id, proveedor_id FROM ofertas WHERE oferta_id = $1", [id])).rows[0]
    : undefined;
  if (!oferta) throw new ErrorHttp(404, "Esa publicación ya no existe.");
  if (oferta.proveedor_id === usuarioId) throw new ErrorHttp(400, "No puedes guardar tu propia publicación en favoritos.");
  const r = await pool.query("INSERT INTO favoritos (usuario_id, oferta_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [usuarioId, id]);
  return { ofertaId: id!, nuevo: (r.rowCount ?? 0) > 0 };
}

export async function quitarFavorito(usuarioId: number, ofertaId: unknown) {
  const id = enteroPositivo(ofertaId);
  if (!id) return false;
  const r = await obtenerPool().query("DELETE FROM favoritos WHERE usuario_id = $1 AND oferta_id = $2", [usuarioId, id]);
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------- ALERTAS
export async function listarAlertas(usuarioId: number) {
  const { rows } = await obtenerPool().query(
    `SELECT a.alerta_id AS "AlertaID", a.palabra_clave AS "PalabraClave", a.categoria_id AS "CategoriaID",
            c.nombre_categoria AS "NombreCategoria", a.precio_maximo AS "PrecioMaximo", a.fecha_creacion AS "FechaCreacion"
     FROM alertas_busqueda a LEFT JOIN categorias_materiales c ON c.categoria_id = a.categoria_id
     WHERE a.usuario_id = $1 ORDER BY a.fecha_creacion DESC, a.alerta_id DESC`,
    [usuarioId]
  );
  return rows.map((a) => ({
    id: a.AlertaID,
    palabraClave: a.PalabraClave,
    categoriaId: a.CategoriaID,
    categoria: a.NombreCategoria,
    precioMaximo: a.PrecioMaximo === null ? null : Number(a.PrecioMaximo),
    descripcion: describirAlerta(a),
    fecha: a.FechaCreacion,
  }));
}

export async function crearAlerta(usuarioId: number, body: Record<string, unknown>) {
  const datos = validarAlerta(body);
  if ("error" in datos) throw new ErrorHttp(400, datos.error!);
  const pool = obtenerPool();
  const {
    rows: [{ total }],
  } = await pool.query("SELECT count(*)::int AS total FROM alertas_busqueda WHERE usuario_id = $1", [usuarioId]);
  if (total >= MAX_ALERTAS) throw new ErrorHttp(409, `Puedes tener como máximo ${MAX_ALERTAS} alertas. Borra alguna antes de crear otra.`);
  // IS NOT DISTINCT FROM compara también los NULL (como <=> en MySQL)
  const { rows: repetidas } = await pool.query(
    `SELECT alerta_id FROM alertas_busqueda
     WHERE usuario_id = $1 AND palabra_clave IS NOT DISTINCT FROM $2::varchar
       AND categoria_id IS NOT DISTINCT FROM $3::int AND precio_maximo IS NOT DISTINCT FROM $4::numeric`,
    [usuarioId, datos.palabraClave, datos.categoriaId, datos.precioMaximo]
  );
  if (repetidas.length) throw new ErrorHttp(409, "Ya tienes una alerta igual.");
  try {
    const {
      rows: [nueva],
    } = await pool.query(
      "INSERT INTO alertas_busqueda (usuario_id, palabra_clave, categoria_id, precio_maximo) VALUES ($1, $2, $3, $4) RETURNING alerta_id",
      [usuarioId, datos.palabraClave, datos.categoriaId, datos.precioMaximo]
    );
    return (await listarAlertas(usuarioId)).find((a) => a.id === nueva.alerta_id);
  } catch (err) {
    if ((err as { code?: string }).code === "23503") throw new ErrorHttp(400, "La categoría elegida no existe.");
    throw err;
  }
}

export async function borrarAlerta(usuarioId: number, alertaId: unknown) {
  const id = enteroPositivo(alertaId);
  if (!id) return false;
  const r = await obtenerPool().query("DELETE FROM alertas_busqueda WHERE alerta_id = $1 AND usuario_id = $2", [id, usuarioId]);
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------- AVISOS
// Se publicó algo nuevo: avisar (después de responder) a quienes tienen una alerta que
// lo cumple. Una sola notificación por persona aunque cumpla varias de sus alertas.
export function avisarNuevaPublicacion(oferta: OfertaParaAvisos, urlBase: string | null) {
  after(async () => {
    try {
      const { rows: alertas } = await obtenerPool().query(
        `SELECT a.alerta_id AS "AlertaID", a.usuario_id AS "UsuarioID", a.palabra_clave AS "PalabraClave",
                a.categoria_id AS "CategoriaID", a.precio_maximo AS "PrecioMaximo", c.nombre_categoria AS "NombreCategoria"
         FROM alertas_busqueda a
         JOIN usuarios u ON u.usuario_id = a.usuario_id AND u.estado_cuenta = 'Activo'
         LEFT JOIN categorias_materiales c ON c.categoria_id = a.categoria_id
         WHERE a.usuario_id <> $1
           AND (a.categoria_id IS NULL OR a.categoria_id = $2)
           AND (a.precio_maximo IS NULL OR a.precio_maximo >= $3)`,
        [oferta.proveedorId, oferta.categoriaId, oferta.precio]
      );
      const porUsuario = new Map<number, Alerta>();
      for (const a of alertas) {
        if (!porUsuario.has(a.UsuarioID) && cumpleAlerta(a, oferta)) porUsuario.set(a.UsuarioID, a);
      }
      if (porUsuario.size === 0) return;
      const titulo = `Nueva publicación: ${oferta.titulo}`.slice(0, 120);
      const precio = cordobas(oferta.precio);
      await enviarNotificaciones(
        [...porUsuario.values()].map((a) => ({
          usuarioId: a.UsuarioID!,
          tipo: "AlertaBusqueda",
          referenciaId: oferta.ofertaId,
          titulo,
          mensaje: `Cumple tu alerta ${describirAlerta(a)}. Precio: ${precio}.`,
          enlace: `/mercado?oferta=${oferta.ofertaId}`,
          correo: {
            asunto: `Se publicó «${oferta.titulo}» en EntreLazados`,
            titulo: "Se publicó algo que estabas buscando",
            parrafos: [`«${oferta.titulo}» por ${precio}.`, `Cumple tu alerta ${describirAlerta(a)}.`],
            textoBoton: "Ver la publicación",
          },
        })),
        urlBase
      );
    } catch (err) {
      console.error("⚠️ No se pudieron revisar las alertas de búsqueda:", (err as Error).message);
    }
  });
}

// Una publicación bajó de precio: avisar (después de responder) a quienes la guardaron
export function avisarRebaja(
  { ofertaId, proveedorId, titulo, precioAnterior, precioNuevo }: { ofertaId: number; proveedorId: number; titulo: string; precioAnterior: number; precioNuevo: number },
  urlBase: string | null
) {
  if (!(Number(precioNuevo) < Number(precioAnterior))) return;
  after(async () => {
    try {
      const { rows } = await obtenerPool().query<{ usuario_id: number }>(
        "SELECT usuario_id FROM favoritos WHERE oferta_id = $1 AND usuario_id <> $2",
        [ofertaId, proveedorId]
      );
      if (rows.length === 0) return;
      await enviarNotificaciones(
        rows.map((f) => ({
          usuarioId: f.usuario_id,
          tipo: "FavoritoRebajado",
          referenciaId: ofertaId,
          agrupar: true,
          titulo: `Bajó de precio: ${titulo}`.slice(0, 120),
          mensaje: `Una publicación que guardaste pasó de ${cordobas(precioAnterior)} a ${cordobas(precioNuevo)}.`,
          enlace: `/mercado?oferta=${ofertaId}`,
        })),
        urlBase
      );
    } catch (err) {
      console.error("⚠️ No se pudo avisar la rebaja de precio:", (err as Error).message);
    }
  });
}
