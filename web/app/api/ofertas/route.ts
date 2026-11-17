// /api/ofertas (de rutas/ofertas.js)
//   GET   lista pública, con filtros y paginación
//   POST  publicar (proveedor), con hasta 5 fotos; abre su lote en subasta (7 días)
import { enTransaccion, obtenerPool } from "@/lib/db";
import { borrarFotos, guardarFotos, leerArchivos, revisarArchivos, validarFotos } from "@/lib/fotos";
import { ErrorHttp, conRespaldo, json, leerFormulario, ruta } from "@/lib/http";
import { insertarSubasta, traducirErrorCategoria, urlsDeFotos, validarOferta } from "@/lib/ofertas";
import { exigirRoles, exigirSesion } from "@/lib/sesion";
import { aTodos } from "@/lib/tiempo-real";
import {
  enteroPositivo,
  leerFotosAntiguas,
  leerPaginacion,
  patronLike,
  redondearCalificacion,
  respuestaPaginada,
} from "@/lib/utilidades";

// Filtros opcionales: ?q=texto&categoria=ID&maxKm=30&proveedorId=ID&id=ID
// (q busca en el título y la descripción, sin acentos ni mayúsculas; id trae una sola publicación).
// Con ?pagina=N&porPagina=M responde { datos, total, pagina, porPagina, paginas }.
// Cada oferta trae el nombre de su proveedor y su calificación promedio.
export const GET = conRespaldo([], async (req) => {
  const query = new URL(req.url).searchParams;
  const pag = leerPaginacion(query, 12);
  const condiciones: string[] = [];
  const params: unknown[] = [];
  const p = (valor: unknown) => `$${params.push(valor)}`;

  const q = query.get("q");
  if (q && q.trim()) {
    const patron = p(patronLike(q));
    condiciones.push(`(unaccent(o.titulo_material) ILIKE unaccent(${patron}) OR unaccent(o.descripcion) ILIKE unaccent(${patron}))`);
  }
  const categoria = enteroPositivo(query.get("categoria"));
  if (categoria) condiciones.push(`o.categoria_id = ${p(categoria)}`);
  const maxKmTexto = query.get("maxKm");
  const maxKm = Number(maxKmTexto);
  if (maxKmTexto !== null && maxKmTexto !== "" && Number.isFinite(maxKm)) condiciones.push(`o.distancia_simulada_km <= ${p(maxKm)}`);
  const proveedor = enteroPositivo(query.get("proveedorId"));
  if (proveedor) condiciones.push(`o.proveedor_id = ${p(proveedor)}`);
  const unaOferta = enteroPositivo(query.get("id"));
  if (unaOferta) condiciones.push(`o.oferta_id = ${p(unaOferta)}`);
  const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";
  const paramsFiltro = [...params];
  const limite = pag ? `LIMIT ${p(pag.porPagina)} OFFSET ${p(pag.offset)}` : "";

  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT o.oferta_id AS "OfertaID", o.proveedor_id AS "ProveedorID", o.titulo_material AS "TituloMaterial",
            o.descripcion AS "Descripcion", o.precio AS "Precio", o.unidad_medida AS "UnidadMedida",
            o.distancia_simulada_km AS "DistanciaSimuladaKm", o.fotos AS "Fotos",
            o.categoria_id AS "CategoriaID", c.nombre_categoria AS "NombreCategoria", o.fecha_publicacion AS "FechaPublicacion",
            COALESCE(pr.nombre_razon_social, 'Proveedor') AS "NombreProveedor",
            cal.promedio AS "CalificacionProveedor", COALESCE(cal.total, 0) AS "TotalCalificaciones"
     FROM ofertas o
     JOIN categorias_materiales c ON o.categoria_id = c.categoria_id
     LEFT JOIN perfiles_usuarios pr ON pr.usuario_id = o.proveedor_id
     LEFT JOIN (SELECT calificado_id, avg(puntuacion) AS promedio, count(*)::int AS total
                FROM calificaciones GROUP BY calificado_id) cal ON cal.calificado_id = o.proveedor_id
     ${where}
     ORDER BY o.fecha_publicacion DESC, o.oferta_id DESC
     ${limite}`,
    params
  );

  const fotosPorOferta = await urlsDeFotos(rows.map((o) => o.OfertaID));
  const lista = rows.map((oferta) => ({
    ...oferta,
    Fotos: fotosPorOferta.get(oferta.OfertaID) || leerFotosAntiguas(oferta.Fotos),
    CalificacionProveedor: redondearCalificacion(oferta.CalificacionProveedor),
    TotalCalificaciones: Number(oferta.TotalCalificaciones),
  }));
  if (!pag) return json(lista);
  const {
    rows: [{ total }],
  } = await pool.query(`SELECT count(*)::int AS total FROM ofertas o ${where}`, paramsFiltro);
  return json(respuestaPaginada(lista, total, pag));
});

// PUBLICAR. Acepta JSON (sin fotos) o multipart/form-data con hasta 5 archivos en "fotos".
export const POST = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  exigirRoles(usuario, "proveedor");
  // El proveedor es SIEMPRE el usuario de la sesión, nunca el que envíe el navegador
  const proveedorId = usuario.id;
  const { campos, archivos } = await leerFormulario(req);
  const errorArchivos = revisarArchivos(archivos);
  if (errorArchivos) throw new ErrorHttp(400, errorArchivos);
  const datos = validarOferta(campos);
  if ("error" in datos) throw new ErrorHttp(400, datos.error);
  const fotos = await leerArchivos(archivos);
  const errorFotos = validarFotos(fotos);
  if (errorFotos) throw new ErrorHttp(400, errorFotos);

  // Primero se guardan los archivos; si la base de datos falla, se borran
  const urls = await guardarFotos(fotos);
  let ofertaId: number;
  try {
    ofertaId = await enTransaccion(async (c) => {
      const {
        rows: [oferta],
      } = await c.query(
        `INSERT INTO ofertas (proveedor_id, titulo_material, descripcion, categoria_id, precio, unidad_medida, distancia_simulada_km)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING oferta_id`,
        [proveedorId, datos.titulo, datos.descripcion, datos.categoriaId, datos.precio, datos.unidad, datos.distancia]
      );
      if (urls.length > 0) {
        await c.query(
          `INSERT INTO fotos_ofertas (oferta_id, foto_url, es_principal)
           SELECT $1, u, o = 1 FROM unnest($2::text[]) WITH ORDINALITY AS x(u, o)`,
          [oferta.oferta_id, urls]
        );
      }
      await insertarSubasta(c, {
        proveedorId,
        ofertaId: oferta.oferta_id,
        categoriaId: datos.categoriaId,
        titulo: datos.titulo,
        precioBase: datos.precio,
      });
      return oferta.oferta_id as number;
    });
  } catch (err) {
    await borrarFotos(urls);
    throw traducirErrorCategoria(err);
  }
  aTodos("subastas:cambio", { motivo: "nueva" });
  // Las alertas de búsqueda (favoritos.avisarNuevaPublicacion) llegan con la rama de favoritos
  return json({ message: "¡Material publicado y lote en subasta activo exitosamente!", ofertaId, fotos: urls });
});
