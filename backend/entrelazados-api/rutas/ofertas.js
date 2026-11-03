// ==========================================================================
// OFERTAS (publicaciones de materia prima)
//   GET    /api/ofertas         lista pública, con filtros y paginación
//   POST   /api/ofertas         publicar (proveedor), con hasta 5 fotos
//   PUT    /api/ofertas/:id     editar (su dueño o el admin)
//   DELETE /api/ofertas/:id     eliminar (su dueño o el admin)
// ==========================================================================
const express = require('express');
const limites = require('../middlewares/limites');
const fotos = require('../servicios/fotos');
const { enTransaccion } = require('../db');
const {
    validarOferta, esCategoriaInvalida, leerFotosAntiguas, insertarSubasta, mensajeOfertaBorrada
} = require('../servicios/ofertas');
const {
    ErrorHttp, enteroPositivo, leerPaginacion, respuestaPaginada, patronLike, redondearCalificacion, conRespaldo
} = require('../utilidades');

// La categoría no existe -> 400 con mensaje claro; otro error sigue su camino
function traducirErrorCategoria(err) {
    if (esCategoriaInvalida(err)) return new ErrorHttp(400, "La categoría elegida no existe.");
    return err;
}

// fotosQuitar puede llegar como JSON ('["/uploads/..."]'), como un solo texto o como campo repetido
function leerFotosQuitar(valor) {
    let lista = valor === undefined ? [] : valor;
    if (typeof lista === 'string') {
        try { lista = lista.trim().startsWith('[') ? JSON.parse(lista) : [lista]; } catch (e) { lista = null; }
    }
    if (!Array.isArray(lista) || !lista.every(u => typeof u === 'string')) {
        throw new ErrorHttp(400, "La lista de fotos a quitar no es válida.");
    }
    return lista;
}

function crearRutasOfertas({ db, ofertas, verificarToken, soloRoles }) {
    const router = express.Router();

    // Filtros opcionales: ?q=texto&categoria=ID&maxKm=30&proveedorId=ID
    // Con ?pagina=N&porPagina=M responde { datos, total, pagina, porPagina, paginas }.
    // Cada oferta trae el nombre de su proveedor y su calificación promedio.
    router.get('/', conRespaldo([], async (req, res) => {
        const pag = leerPaginacion(req.query, 12);
        const condiciones = [];
        const params = [];
        if (typeof req.query.q === 'string' && req.query.q.trim()) {
            condiciones.push('o.TituloMaterial LIKE ?');
            params.push(patronLike(req.query.q));
        }
        const categoria = enteroPositivo(req.query.categoria);
        if (categoria) { condiciones.push('o.CategoriaID = ?'); params.push(categoria); }
        const maxKm = Number(req.query.maxKm);
        if (req.query.maxKm !== undefined && req.query.maxKm !== '' && Number.isFinite(maxKm)) {
            condiciones.push('o.DistanciaSimuladaKm <= ?');
            params.push(maxKm);
        }
        const proveedor = enteroPositivo(req.query.proveedorId);
        if (proveedor) { condiciones.push('o.ProveedorID = ?'); params.push(proveedor); }
        const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';

        const [filas] = await db.query(`
            SELECT o.OfertaID, o.ProveedorID, o.TituloMaterial, o.Precio, o.UnidadMedida, o.DistanciaSimuladaKm, o.Fotos,
                   o.CategoriaID, c.NombreCategoria, o.FechaPublicacion,
                   COALESCE(pr.NombreRazonSocial, 'Proveedor') AS NombreProveedor,
                   cal.Promedio AS CalificacionProveedor, COALESCE(cal.Total, 0) AS TotalCalificaciones
            FROM Ofertas o
            JOIN CategoriasMateriales c ON o.CategoriaID = c.CategoriaID
            LEFT JOIN PerfilesUsuarios pr ON pr.UsuarioID = o.ProveedorID
            LEFT JOIN (SELECT CalificadoID, AVG(Puntuacion) AS Promedio, COUNT(*) AS Total
                       FROM Calificaciones GROUP BY CalificadoID) cal ON cal.CalificadoID = o.ProveedorID
            ${where}
            ORDER BY o.FechaPublicacion DESC, o.OfertaID DESC
            ${pag ? 'LIMIT ? OFFSET ?' : ''}
        `, pag ? [...params, pag.porPagina, pag.offset] : params);

        const fotosPorOferta = await ofertas.urlsDeFotos(filas.map(o => o.OfertaID));
        const lista = filas.map(oferta => ({
            ...oferta,
            Fotos: fotosPorOferta.get(oferta.OfertaID) || leerFotosAntiguas(oferta.Fotos),
            CalificacionProveedor: redondearCalificacion(oferta.CalificacionProveedor),
            TotalCalificaciones: Number(oferta.TotalCalificaciones)
        }));
        if (!pag) return res.json(lista);
        const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM Ofertas o ${where}`, params);
        res.json(respuestaPaginada(lista, Number(total), pag));
    }));

    // PUBLICAR. Acepta JSON (sin fotos) o multipart/form-data con hasta 5 archivos en el campo "fotos".
    // Junto con la publicación se abre su lote en subasta (7 días).
    router.post('/', verificarToken, soloRoles('proveedor'), limites.fotos, fotos.recibirFotos, async (req, res) => {
        // El proveedor es SIEMPRE el usuario de la sesión, nunca el que envíe el navegador
        const proveedorId = req.usuario.id;
        const archivos = req.files || [];
        const datos = validarOferta(req.body);
        if (datos.error) throw new ErrorHttp(400, datos.error);
        const errorFotos = fotos.validarFotos(archivos);
        if (errorFotos) throw new ErrorHttp(400, errorFotos);

        // Primero se guardan los archivos; si la base de datos falla, se borran
        const urls = await fotos.guardarFotos(archivos);
        try {
            const ofertaId = await enTransaccion(db, async (conn) => {
                const [oferta] = await conn.query(
                    `INSERT INTO Ofertas (ProveedorID, TituloMaterial, CategoriaID, Precio, UnidadMedida, DistanciaSimuladaKm)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [proveedorId, datos.titulo, datos.categoriaId, datos.precio, datos.unidad, datos.distancia]
                );
                if (urls.length > 0) {
                    await conn.query(
                        'INSERT INTO FotosOfertas (OfertaID, FotoURL, EsPrincipal) VALUES ?',
                        [urls.map((url, i) => [oferta.insertId, url, i === 0 ? 1 : 0])]
                    );
                }
                await insertarSubasta(conn, {
                    proveedorId,
                    ofertaId: oferta.insertId,
                    categoriaId: datos.categoriaId,
                    titulo: datos.titulo,
                    precioBase: datos.precio
                });
                return oferta.insertId;
            });
            res.json({ message: "¡Material publicado y lote en subasta activo exitosamente!", ofertaId, fotos: urls });
        } catch (err) {
            await fotos.borrarFotos(urls);
            throw traducirErrorCategoria(err);
        }
    });

    // EDITAR UNA PUBLICACIÓN (su dueño o el admin). Mismos campos que al publicar y, además:
    //   fotosQuitar: direcciones de fotos actuales que se borran (JSON o campo repetido)
    //   fotos:       fotos nuevas (multipart), hasta completar 5 en total
    // Si la publicación tiene una subasta abierta, esta toma el título y la categoría nuevos
    // (su precio no cambia: ya puede tener pujas).
    router.put('/:id', verificarToken, soloRoles('proveedor'), limites.fotos, fotos.recibirFotos, async (req, res) => {
        const ofertaId = enteroPositivo(req.params.id);
        const archivos = req.files || [];
        const noEsTuya = new ErrorHttp(404, "Esa publicación no existe o no es tuya.");
        if (!ofertaId) throw noEsTuya;
        const datos = validarOferta(req.body);
        if (datos.error) throw new ErrorHttp(400, datos.error);
        const errorFotos = fotos.validarFotos(archivos);
        if (errorFotos) throw new ErrorHttp(400, errorFotos);
        const quitar = leerFotosQuitar(req.body.fotosQuitar);

        let urlsNuevas = [];
        let resultado;
        try {
            resultado = await enTransaccion(db, async (conn) => {
                const [[oferta]] = await conn.query(
                    `SELECT OfertaID, Fotos FROM Ofertas WHERE OfertaID = ? ${req.usuario.esAdmin ? '' : 'AND ProveedorID = ?'} FOR UPDATE`,
                    req.usuario.esAdmin ? [ofertaId] : [ofertaId, req.usuario.id]
                );
                if (!oferta) throw noEsTuya;

                const [filasFotos] = await conn.query('SELECT FotoID, FotoURL FROM FotosOfertas WHERE OfertaID = ?', [ofertaId]);
                // Fotos antiguas guardadas como texto (solo cuentan si no hay fotos en la tabla)
                const antiguas = filasFotos.length ? [] : leerFotosAntiguas(oferta.Fotos);
                const borradas = filasFotos.filter(f => quitar.includes(f.FotoURL));
                const antiguasQuedan = antiguas.filter(u => !quitar.includes(u));
                const totalFinal = filasFotos.length - borradas.length + antiguasQuedan.length + archivos.length;
                if (totalFinal > fotos.MAX_FOTOS) {
                    throw new ErrorHttp(400, `Puedes tener como máximo ${fotos.MAX_FOTOS} fotos por publicación. Quita alguna antes de agregar más.`);
                }

                urlsNuevas = await fotos.guardarFotos(archivos);
                await conn.query(
                    'UPDATE Ofertas SET TituloMaterial = ?, CategoriaID = ?, Precio = ?, UnidadMedida = ?, DistanciaSimuladaKm = ? WHERE OfertaID = ?',
                    [datos.titulo, datos.categoriaId, datos.precio, datos.unidad, datos.distancia, ofertaId]
                );
                if (antiguasQuedan.length !== antiguas.length) {
                    await conn.query('UPDATE Ofertas SET Fotos = ? WHERE OfertaID = ?', [JSON.stringify(antiguasQuedan), ofertaId]);
                }
                if (borradas.length) {
                    await conn.query('DELETE FROM FotosOfertas WHERE FotoID IN (?)', [borradas.map(f => f.FotoID)]);
                }
                if (urlsNuevas.length) {
                    await conn.query('INSERT INTO FotosOfertas (OfertaID, FotoURL, EsPrincipal) VALUES ?', [urlsNuevas.map(u => [ofertaId, u, 0])]);
                }
                // Si se quitó la foto principal, pasa a serlo la primera que queda
                const [[principal]] = await conn.query(
                    'SELECT FotoID FROM FotosOfertas WHERE OfertaID = ? ORDER BY EsPrincipal DESC, FotoID LIMIT 1', [ofertaId]
                );
                if (principal) {
                    await conn.query('UPDATE FotosOfertas SET EsPrincipal = (FotoID = ?) WHERE OfertaID = ?', [principal.FotoID, ofertaId]);
                }
                const [subasta] = await conn.query(
                    "UPDATE Subastas SET TituloLote = ?, CategoriaID = ? WHERE OfertaID = ? AND Estado = 'Activa' AND FechaFin > NOW()",
                    [`Lote Subasta: ${datos.titulo}`, datos.categoriaId, ofertaId]
                );
                return { borradas, antiguasQuedan, subastaActualizada: subasta.affectedRows > 0 };
            });
        } catch (err) {
            await fotos.borrarFotos(urlsNuevas);
            throw traducirErrorCategoria(err);
        }

        await fotos.borrarFotos(resultado.borradas.map(f => f.FotoURL));
        const fotosFinales = (await ofertas.urlsDeFotos([ofertaId])).get(ofertaId) || resultado.antiguasQuedan;
        res.json({
            message: resultado.subastaActualizada
                ? "Publicación actualizada. Su subasta abierta también muestra el título y la categoría nuevos."
                : "Publicación actualizada.",
            ofertaId,
            fotos: fotosFinales
        });
    });

    // ELIMINAR: un proveedor solo puede borrar sus propias ofertas; el admin puede borrar cualquiera
    router.delete('/:id', verificarToken, async (req, res) => {
        const resultado = req.usuario.esAdmin
            ? await ofertas.eliminarOferta(req.params.id, { moderadorId: req.usuario.id })
            : await ofertas.eliminarOferta(req.params.id, { proveedorId: req.usuario.id });
        if (resultado.pujas > 0) {
            throw new ErrorHttp(409,
                `Esta publicación tiene una subasta abierta con ${resultado.pujas} puja(s). Podrás borrarla cuando la subasta cierre.`,
                { pujas: resultado.pujas });
        }
        if (!resultado.borrada) {
            throw new ErrorHttp(403, "No tienes permiso para eliminar esta oferta o no existe.");
        }
        res.json({
            success: true,
            message: mensajeOfertaBorrada(resultado, "Oferta eliminada correctamente."),
            subastasCanceladas: resultado.subastasCanceladas,
            pujadoresAvisados: resultado.pujadoresAvisados
        });
    });

    return router;
}

module.exports = crearRutasOfertas;
