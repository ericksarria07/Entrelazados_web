// ==========================================================================
// OFERTAS (publicaciones) Y SUS SUBASTAS (equivale a servicios/ofertas.js)
//
// Lo que usan varias rutas: validar una publicación, leer sus fotos, crear el
// lote en subasta y borrar una publicación (la borra su dueño o el admin).
// ==========================================================================
import type { PoolClient } from "pg";
import { enTransaccion, obtenerPool } from "@/lib/db";
import { borrarFotos } from "@/lib/fotos";
import { ErrorHttp } from "@/lib/http";
import { type AvisoCancelacion, avisarCancelacion, avisarPujadoresCancelacion } from "@/lib/subastas";
import { aTodos } from "@/lib/tiempo-real";
import { enteroPositivo } from "@/lib/utilidades";

const MOTIVO_MODERACION = "por moderación del administrador";

// Reglas puras de una publicación (en ofertas-reglas.ts para poder probarlas sin base de datos)
import { DIAS_SUBASTA } from "@/lib/ofertas-reglas";
export { DIAS_SUBASTA, LARGO_DESCRIPCION, PRECIO_MAXIMO, validarOferta, type DatosOferta } from "@/lib/ofertas-reglas";

// Postgres rechaza la llave foránea (23503) cuando la categoría elegida no existe
export function traducirErrorCategoria(err: unknown): unknown {
  if ((err as { code?: string }).code === "23503") return new ErrorHttp(400, "La categoría elegida no existe.");
  return err;
}

// Crea una subasta dentro de una transacción ya abierta (c).
// ofertaId liga el lote a su publicación: muestra sus fotos y se cancela si la publicación se borra.
export async function insertarSubasta(
  c: PoolClient,
  {
    proveedorId,
    ofertaId = null,
    categoriaId,
    titulo,
    precioBase,
    dias = DIAS_SUBASTA.porDefecto,
  }: { proveedorId: number; ofertaId?: number | null; categoriaId: number; titulo: string; precioBase: number; dias?: number }
) {
  const fechaFin = new Date();
  fechaFin.setDate(fechaFin.getDate() + dias);
  const {
    rows: [s],
  } = await c.query(
    `INSERT INTO subastas (proveedor_id, oferta_id, categoria_id, titulo_lote, precio_base, precio_actual, fecha_fin, estado)
     VALUES ($1, $2, $3, $4, $5, $5, $6, 'Activa') RETURNING subasta_id`,
    [proveedorId, ofertaId, categoriaId, `Lote Subasta: ${titulo}`, precioBase, fechaFin]
  );
  return { subastaId: s.subasta_id as number, fechaFin };
}

// Direcciones de las fotos de las ofertas indicadas: Map(OfertaID -> [url, ...]), la principal primero
export async function urlsDeFotos(ofertaIds: number[]): Promise<Map<number, string[]>> {
  const mapa = new Map<number, string[]>();
  if (!ofertaIds.length) return mapa;
  const { rows } = await obtenerPool().query<{ oferta_id: number; foto_url: string }>(
    "SELECT oferta_id, foto_url FROM fotos_ofertas WHERE oferta_id = ANY($1) ORDER BY es_principal DESC, foto_id",
    [ofertaIds]
  );
  for (const f of rows) {
    if (!mapa.has(f.oferta_id)) mapa.set(f.oferta_id, []);
    mapa.get(f.oferta_id)!.push(f.foto_url);
  }
  return mapa;
}

// Texto de respuesta después de borrar una publicación
export function mensajeOfertaBorrada(r: { subastasCanceladas: number; pujadoresAvisados: number }, base: string) {
  let texto = base;
  if (r.subastasCanceladas > 0) texto += " Su subasta abierta también se canceló.";
  if (r.pujadoresAvisados > 0) texto += ` Avisamos por el chat a ${r.pujadoresAvisados} persona(s) que habían pujado.`;
  return texto;
}

export type ResultadoBorrado = { borrada: boolean; pujas: number; subastasCanceladas: number; pujadoresAvisados: number };

// Borra una oferta con sus fotos y cancela su subasta si sigue abierta.
// Con proveedorId solo la borra si es de ese proveedor, y NO si su subasta abierta ya
// tiene pujas (no se le quita el lote a quien va ganando). El admin (moderadorId) sí
// puede: la subasta queda 'Cancelada' y se avisa a quienes pujaron.
// Las subastas ya vencidas no se tocan: el cierre les da su ganador.
export async function eliminarOferta(
  idOferta: unknown,
  { proveedorId = null, moderadorId = null, urlBase = null }: { proveedorId?: number | null; moderadorId?: number | null; urlBase?: string | null }
): Promise<ResultadoBorrado> {
  const noBorrada = (pujas = 0): ResultadoBorrado => ({ borrada: false, pujas, subastasCanceladas: 0, pujadoresAvisados: 0 });
  const ofertaId = enteroPositivo(idOferta);
  if (!ofertaId) return noBorrada();
  const soloDelProveedor = proveedorId !== null;

  const resultado = await enTransaccion(async (c) => {
    const {
      rows: [oferta],
    } = await c.query(
      `SELECT oferta_id FROM ofertas WHERE oferta_id = $1 ${soloDelProveedor ? "AND proveedor_id = $2" : ""} FOR UPDATE`,
      soloDelProveedor ? [ofertaId, proveedorId] : [ofertaId]
    );
    if (!oferta) return { ...noBorrada(), urlsFotos: [] as string[], avisos: [] as AvisoCancelacion[] };

    // FOR UPDATE: una puja que llegue mientras tanto espera y luego ve la subasta cancelada
    const { rows: abiertas } = await c.query<{ subasta_id: number; pujas: number }>(
      `SELECT s.subasta_id, (SELECT count(*)::int FROM pujas p WHERE p.subasta_id = s.subasta_id) AS pujas
       FROM subastas s
       WHERE s.oferta_id = $1 AND s.estado = 'Activa' AND s.fecha_fin > now()
       FOR UPDATE OF s`,
      [ofertaId]
    );
    const pujas = abiertas.reduce((total, s) => total + s.pujas, 0);
    if (soloDelProveedor && pujas > 0) return { ...noBorrada(pujas), urlsFotos: [] as string[], avisos: [] as AvisoCancelacion[] };

    let avisos: AvisoCancelacion[] = [];
    if (abiertas.length > 0) {
      await c.query("UPDATE subastas SET estado = 'Cancelada' WHERE subasta_id = ANY($1)", [abiertas.map((s) => s.subasta_id)]);
      if (moderadorId && pujas > 0) {
        avisos = await avisarPujadoresCancelacion(c, {
          subastaIds: abiertas.filter((s) => s.pujas > 0).map((s) => s.subasta_id),
          remitenteId: moderadorId,
          motivo: MOTIVO_MODERACION,
        });
      }
    }

    const { rows: filasFotos } = await c.query<{ foto_url: string }>("SELECT foto_url FROM fotos_ofertas WHERE oferta_id = $1", [ofertaId]);
    // Las fotos_ofertas se borran en cascada; las subastas conservan su historial (oferta_id = NULL)
    await c.query("DELETE FROM ofertas WHERE oferta_id = $1", [ofertaId]);
    return {
      borrada: true,
      pujas: 0,
      subastasCanceladas: abiertas.length,
      pujadoresAvisados: new Set(avisos.map((a) => a.emprendedorId)).size,
      urlsFotos: filasFotos.map((f) => f.foto_url),
      avisos,
    };
  });

  const { urlsFotos, avisos, ...respuesta } = resultado;
  if (!respuesta.borrada) return respuesta;
  // Después del COMMIT: borrar los archivos y avisar
  await borrarFotos(urlsFotos);
  if (respuesta.subastasCanceladas > 0) aTodos("subastas:cambio", { motivo: "cancelada" });
  await avisarCancelacion(avisos, MOTIVO_MODERACION, urlBase);
  return respuesta;
}
