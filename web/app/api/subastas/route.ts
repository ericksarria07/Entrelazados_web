// /api/subastas (de rutas/subastas.js)
//   GET   subastas abiertas, con filtros y paginación
//   POST  crear una subasta desde el Mercado (proveedor)
import { enTransaccion, obtenerPool } from "@/lib/db";
import { ErrorHttp, conRespaldo, json, leerCuerpo, ruta } from "@/lib/http";
import { DIAS_SUBASTA, PRECIO_MAXIMO, insertarSubasta, traducirErrorCategoria, urlsDeFotos } from "@/lib/ofertas";
import { exigirRoles, exigirSesion } from "@/lib/sesion";
import { aTodos } from "@/lib/tiempo-real";
import { enteroPositivo, leerFotosAntiguas, leerPaginacion, patronLike, respuestaPaginada } from "@/lib/utilidades";

// Solo las que siguen abiertas: una vencida desaparece de la lista aunque el cierre
// todavía no haya pasado por ella. Cada una trae la foto principal y la categoría de su
// publicación. Primero las que cierran antes.
// Filtros opcionales: ?q=texto&categoria=ID&proveedorId=ID. Con ?pagina=N&porPagina=M responde paginado.
export const GET = conRespaldo([], async (req) => {
  const query = new URL(req.url).searchParams;
  const pag = leerPaginacion(query, 10);
  const condiciones = ["s.estado = 'Activa'", "s.fecha_fin > now()"];
  const params: unknown[] = [];
  const p = (valor: unknown) => `$${params.push(valor)}`;
  const q = query.get("q");
  if (q && q.trim()) condiciones.push(`unaccent(s.titulo_lote) ILIKE unaccent(${p(patronLike(q))})`);
  const categoria = enteroPositivo(query.get("categoria"));
  if (categoria) condiciones.push(`s.categoria_id = ${p(categoria)}`);
  const proveedor = enteroPositivo(query.get("proveedorId"));
  if (proveedor) condiciones.push(`s.proveedor_id = ${p(proveedor)}`);
  const where = "WHERE " + condiciones.join(" AND ");
  const paramsFiltro = [...params];
  const limite = pag ? `LIMIT ${p(pag.porPagina)} OFFSET ${p(pag.offset)}` : "";

  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT s.subasta_id AS "SubastaID", s.proveedor_id AS "ProveedorID", s.oferta_id AS "OfertaID",
            s.categoria_id AS "CategoriaID", s.titulo_lote AS "TituloLote", s.precio_base AS "PrecioBase",
            s.precio_actual AS "PrecioActual", s.fecha_fin AS "FechaFin", s.estado AS "Estado",
            c.nombre_categoria AS "NombreCategoria", o.fotos AS "FotosAntiguas",
            (SELECT count(*)::int FROM pujas p WHERE p.subasta_id = s.subasta_id) AS "TotalPujas"
     FROM subastas s
     LEFT JOIN categorias_materiales c ON c.categoria_id = s.categoria_id
     LEFT JOIN ofertas o ON o.oferta_id = s.oferta_id
     ${where}
     ORDER BY s.fecha_fin, s.subasta_id
     ${limite}`,
    params
  );

  const fotosPorOferta = await urlsDeFotos([...new Set(rows.map((s) => s.OfertaID).filter(Boolean))]);
  const lista = rows.map(({ FotosAntiguas, ...s }) => ({
    ...s,
    TotalPujas: Number(s.TotalPujas),
    Foto: (fotosPorOferta.get(s.OfertaID) || leerFotosAntiguas(FotosAntiguas))[0] || null,
  }));
  if (!pag) return json(lista);
  const {
    rows: [{ total }],
  } = await pool.query(`SELECT count(*)::int AS total FROM subastas s ${where}`, paramsFiltro);
  return json(respuestaPaginada(lista, total, pag));
});

// CREAR UNA SUBASTA (botón "Crear Subasta"): proveedores (y el admin).
// Con ofertaId, el lote sale de una de sus publicaciones (toma su título, categoría y fotos);
// sin ofertaId, es un lote nuevo con título y categoría propios.
export const POST = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  exigirRoles(usuario, "proveedor");
  const b = await leerCuerpo(req);
  const proveedorId = usuario.id;
  const ofertaId = b.ofertaId ? Number(b.ofertaId) : null;
  const precioBase = Number(b.precioBase);
  const dias = b.dias === undefined || b.dias === "" ? DIAS_SUBASTA.porDefecto : Number(b.dias);
  const tituloEscrito = typeof b.tituloLote === "string" ? b.tituloLote.trim() : "";

  if (!(precioBase > 0) || precioBase > PRECIO_MAXIMO) throw new ErrorHttp(400, "El precio base debe ser un número mayor que 0.");
  if (!Number.isInteger(dias) || dias < DIAS_SUBASTA.minimo || dias > DIAS_SUBASTA.maximo) {
    throw new ErrorHttp(400, `La subasta debe durar de ${DIAS_SUBASTA.minimo} a ${DIAS_SUBASTA.maximo} días.`);
  }
  if (ofertaId !== null && !(Number.isInteger(ofertaId) && ofertaId > 0)) {
    throw new ErrorHttp(400, "La publicación elegida no es válida.");
  }

  let creada;
  try {
    creada = await enTransaccion(async (c) => {
      let titulo = tituloEscrito;
      let categoriaId = enteroPositivo(b.categoriaId);
      if (ofertaId) {
        // FOR UPDATE: dos clics seguidos no pueden abrir dos subastas de la misma publicación
        const {
          rows: [oferta],
        } = await c.query(
          "SELECT titulo_material, categoria_id FROM ofertas WHERE oferta_id = $1 AND proveedor_id = $2 FOR UPDATE",
          [ofertaId, proveedorId]
        );
        if (!oferta) throw new ErrorHttp(404, "Esa publicación no existe o no es tuya.");
        const { rows: abiertas } = await c.query(
          "SELECT subasta_id FROM subastas WHERE oferta_id = $1 AND estado = 'Activa' AND fecha_fin > now() LIMIT 1",
          [ofertaId]
        );
        if (abiertas.length) throw new ErrorHttp(409, "Esa publicación ya tiene una subasta abierta.");
        titulo = titulo || oferta.titulo_material;
        categoriaId = oferta.categoria_id;
      }
      if (!titulo || !categoriaId) throw new ErrorHttp(400, "Escribe el título del lote y elige una categoría.");
      if (titulo.length > 120) throw new ErrorHttp(400, "El título puede tener como máximo 120 caracteres.");
      return insertarSubasta(c, { proveedorId, ofertaId, categoriaId, titulo, precioBase, dias });
    });
  } catch (err) {
    throw traducirErrorCategoria(err);
  }
  aTodos("subastas:cambio", { subastaId: creada.subastaId, motivo: "nueva" });
  return json(
    {
      message: `¡Subasta creada! Recibirá pujas durante ${dias} día${dias === 1 ? "" : "s"}.`,
      subastaId: creada.subastaId,
      fechaFin: creada.fechaFin,
    },
    201
  );
});
