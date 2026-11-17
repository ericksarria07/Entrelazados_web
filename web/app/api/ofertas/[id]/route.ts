// /api/ofertas/[id] (de rutas/ofertas.js)
//   PUT     editar (su dueño o el admin)
//   DELETE  eliminar (su dueño o el admin)
import { urlPublica } from "@/lib/config";
import { enTransaccion } from "@/lib/db";
import { avisarRebaja } from "@/lib/favoritos";
import { MAX_FOTOS, borrarFotos, guardarFotos, leerArchivos, revisarArchivos, validarFotos } from "@/lib/fotos";
import { ErrorHttp, json, leerFormulario, ruta } from "@/lib/http";
import { eliminarOferta, mensajeOfertaBorrada, traducirErrorCategoria, urlsDeFotos, validarOferta } from "@/lib/ofertas";
import { exigirRoles, exigirSesion } from "@/lib/sesion";
import { aTodos } from "@/lib/tiempo-real";
import { enteroPositivo, leerFotosAntiguas } from "@/lib/utilidades";

type Contexto = RouteContext<"/api/ofertas/[id]">;

// fotosQuitar puede llegar como JSON ('["/uploads/..."]'), como un solo texto o como campo repetido
function leerFotosQuitar(valor: unknown): string[] {
  let lista: unknown = valor === undefined ? [] : valor;
  if (typeof lista === "string") {
    try {
      lista = lista.trim().startsWith("[") ? JSON.parse(lista) : [lista];
    } catch {
      lista = null;
    }
  }
  if (!Array.isArray(lista) || !lista.every((u) => typeof u === "string")) {
    throw new ErrorHttp(400, "La lista de fotos a quitar no es válida.");
  }
  return lista;
}

// EDITAR. Mismos campos que al publicar y, además:
//   fotosQuitar: direcciones de fotos actuales que se borran
//   fotos:       fotos nuevas (multipart), hasta completar 5 en total
// Si la publicación tiene una subasta abierta, esta toma el título y la categoría nuevos
// (su precio no cambia: ya puede tener pujas).
export const PUT = ruta<Contexto>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  exigirRoles(usuario, "proveedor");
  const { campos, archivos } = await leerFormulario(req);
  const errorArchivos = revisarArchivos(archivos);
  if (errorArchivos) throw new ErrorHttp(400, errorArchivos);
  const ofertaId = enteroPositivo((await ctx.params).id);
  const noEsTuya = new ErrorHttp(404, "Esa publicación no existe o no es tuya.");
  if (!ofertaId) throw noEsTuya;
  const datos = validarOferta(campos);
  if ("error" in datos) throw new ErrorHttp(400, datos.error);
  const fotos = await leerArchivos(archivos);
  const errorFotos = validarFotos(fotos);
  if (errorFotos) throw new ErrorHttp(400, errorFotos);
  const quitar = leerFotosQuitar(campos.fotosQuitar);

  let urlsNuevas: string[] = [];
  let resultado;
  try {
    resultado = await enTransaccion(async (c) => {
      const {
        rows: [oferta],
      } = await c.query(
        `SELECT oferta_id, proveedor_id, precio, fotos FROM ofertas
         WHERE oferta_id = $1 ${usuario.esAdmin ? "" : "AND proveedor_id = $2"} FOR UPDATE`,
        usuario.esAdmin ? [ofertaId] : [ofertaId, usuario.id]
      );
      if (!oferta) throw noEsTuya;

      const { rows: filasFotos } = await c.query<{ foto_id: number; foto_url: string }>(
        "SELECT foto_id, foto_url FROM fotos_ofertas WHERE oferta_id = $1",
        [ofertaId]
      );
      // Fotos antiguas guardadas como texto (solo cuentan si no hay fotos en la tabla)
      const antiguas = filasFotos.length ? [] : leerFotosAntiguas(oferta.fotos);
      const borradas = filasFotos.filter((f) => quitar.includes(f.foto_url));
      const antiguasQuedan = antiguas.filter((u) => !quitar.includes(u));
      const totalFinal = filasFotos.length - borradas.length + antiguasQuedan.length + fotos.length;
      if (totalFinal > MAX_FOTOS) {
        throw new ErrorHttp(400, `Puedes tener como máximo ${MAX_FOTOS} fotos por publicación. Quita alguna antes de agregar más.`);
      }

      urlsNuevas = await guardarFotos(fotos);
      await c.query(
        `UPDATE ofertas SET titulo_material = $1, descripcion = $2, categoria_id = $3, precio = $4,
                            unidad_medida = $5, distancia_simulada_km = $6
         WHERE oferta_id = $7`,
        [datos.titulo, datos.descripcion, datos.categoriaId, datos.precio, datos.unidad, datos.distancia, ofertaId]
      );
      if (antiguasQuedan.length !== antiguas.length) {
        await c.query("UPDATE ofertas SET fotos = $1 WHERE oferta_id = $2", [JSON.stringify(antiguasQuedan), ofertaId]);
      }
      if (borradas.length) {
        await c.query("DELETE FROM fotos_ofertas WHERE foto_id = ANY($1)", [borradas.map((f) => f.foto_id)]);
      }
      if (urlsNuevas.length) {
        await c.query(
          "INSERT INTO fotos_ofertas (oferta_id, foto_url, es_principal) SELECT $1, u, false FROM unnest($2::text[]) AS x(u)",
          [ofertaId, urlsNuevas]
        );
      }
      // Si se quitó la foto principal, pasa a serlo la primera que queda
      const {
        rows: [principal],
      } = await c.query(
        "SELECT foto_id FROM fotos_ofertas WHERE oferta_id = $1 ORDER BY es_principal DESC, foto_id LIMIT 1",
        [ofertaId]
      );
      if (principal) {
        await c.query("UPDATE fotos_ofertas SET es_principal = (foto_id = $1) WHERE oferta_id = $2", [principal.foto_id, ofertaId]);
      }
      const subasta = await c.query(
        "UPDATE subastas SET titulo_lote = $1, categoria_id = $2 WHERE oferta_id = $3 AND estado = 'Activa' AND fecha_fin > now()",
        [`Lote Subasta: ${datos.titulo}`, datos.categoriaId, ofertaId]
      );
      return {
        borradas,
        antiguasQuedan,
        subastaActualizada: (subasta.rowCount ?? 0) > 0,
        proveedorId: oferta.proveedor_id as number,
        precioAnterior: Number(oferta.precio),
      };
    });
  } catch (err) {
    await borrarFotos(urlsNuevas);
    throw traducirErrorCategoria(err);
  }

  await borrarFotos(resultado.borradas.map((f) => f.foto_url));
  const fotosFinales = (await urlsDeFotos([ofertaId])).get(ofertaId) || resultado.antiguasQuedan;
  if (resultado.subastaActualizada) aTodos("subastas:cambio", { motivo: "editada" });
  // Si bajó de precio, se avisa a quienes la guardaron en favoritos (después de responder)
  avisarRebaja(
    { ofertaId, proveedorId: resultado.proveedorId, titulo: datos.titulo, precioAnterior: resultado.precioAnterior, precioNuevo: datos.precio },
    urlPublica(req)
  );
  return json({
    message: resultado.subastaActualizada
      ? "Publicación actualizada. Su subasta abierta también muestra el título y la categoría nuevos."
      : "Publicación actualizada.",
    ofertaId,
    fotos: fotosFinales,
  });
});

// ELIMINAR: un proveedor solo puede borrar sus propias ofertas; el admin puede borrar cualquiera
export const DELETE = ruta<Contexto>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  const { id } = await ctx.params;
  const resultado = usuario.esAdmin
    ? await eliminarOferta(id, { moderadorId: usuario.id, urlBase: urlPublica(req) })
    : await eliminarOferta(id, { proveedorId: usuario.id });
  if (resultado.pujas > 0) {
    throw new ErrorHttp(
      409,
      `Esta publicación tiene una subasta abierta con ${resultado.pujas} puja(s). Podrás borrarla cuando la subasta cierre.`,
      { pujas: resultado.pujas }
    );
  }
  if (!resultado.borrada) throw new ErrorHttp(403, "No tienes permiso para eliminar esta oferta o no existe.");
  return json({
    success: true,
    message: mensajeOfertaBorrada(resultado, "Oferta eliminada correctamente."),
    subastasCanceladas: resultado.subastasCanceladas,
    pujadoresAvisados: resultado.pujadoresAvisados,
  });
});
