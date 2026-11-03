// ==========================================================================
// SUBASTAS Y PUJAS (se monta en /api)
//   GET  /api/subastas    subastas abiertas, con filtros y paginación
//   POST /api/subastas    crear una subasta (proveedor)
//   POST /api/pujas       pujar (emprendedor)
// El cierre automático de las vencidas está en servicios/subastas.js.
// Tiempo real: cada puja aceptada se anuncia a todas las páginas ("puja:nueva") y
// se notifica a quien iba ganando (PujaSuperada, también por correo) y al proveedor.
// ==========================================================================
const express = require('express');
const { enTransaccion } = require('../db');
const { leerFotosAntiguas, insertarSubasta, esCategoriaInvalida, DIAS_SUBASTA, PRECIO_MAXIMO } = require('../servicios/ofertas');
const { nombreLote } = require('../servicios/subastas');
const { ErrorHttp, enteroPositivo, leerPaginacion, respuestaPaginada, patronLike, conRespaldo } = require('../utilidades');

const cordobas = (monto) => 'C$' + Number(monto).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function crearRutasSubastas({ db, ofertas, tiempoReal, notificaciones, verificarToken, soloRoles }) {
    const router = express.Router();

    // Solo las que siguen abiertas: una vencida desaparece de la lista aunque el
    // cierre automático todavía no haya pasado por ella.
    // Cada una trae la foto principal y la categoría de su publicación. Primero las que cierran antes.
    // Filtros opcionales: ?q=texto&categoria=ID. Con ?pagina=N&porPagina=M responde paginado.
    router.get('/subastas', conRespaldo([], async (req, res) => {
        const pag = leerPaginacion(req.query, 10);
        const condiciones = ["s.Estado = 'Activa'", 's.FechaFin > NOW()'];
        const params = [];
        if (typeof req.query.q === 'string' && req.query.q.trim()) {
            condiciones.push('s.TituloLote LIKE ?');
            params.push(patronLike(req.query.q));
        }
        const categoria = enteroPositivo(req.query.categoria);
        if (categoria) { condiciones.push('s.CategoriaID = ?'); params.push(categoria); }
        const where = 'WHERE ' + condiciones.join(' AND ');

        const [subastas] = await db.query(`
            SELECT s.SubastaID, s.ProveedorID, s.OfertaID, s.CategoriaID, s.TituloLote, s.PrecioBase,
                   s.PrecioActual, s.FechaFin, s.Estado, c.NombreCategoria, o.Fotos AS FotosAntiguas,
                   (SELECT COUNT(*) FROM Pujas p WHERE p.SubastaID = s.SubastaID) AS TotalPujas
            FROM Subastas s
            LEFT JOIN CategoriasMateriales c ON c.CategoriaID = s.CategoriaID
            LEFT JOIN Ofertas o ON o.OfertaID = s.OfertaID
            ${where}
            ORDER BY s.FechaFin, s.SubastaID
            ${pag ? 'LIMIT ? OFFSET ?' : ''}
        `, pag ? [...params, pag.porPagina, pag.offset] : params);

        const fotosPorOferta = await ofertas.urlsDeFotos([...new Set(subastas.map(s => s.OfertaID).filter(Boolean))]);
        const lista = subastas.map(({ FotosAntiguas, ...s }) => ({
            ...s,
            TotalPujas: Number(s.TotalPujas),
            Foto: (fotosPorOferta.get(s.OfertaID) || leerFotosAntiguas(FotosAntiguas))[0] || null
        }));
        if (!pag) return res.json(lista);
        const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM Subastas s ${where}`, params);
        res.json(respuestaPaginada(lista, Number(total), pag));
    }));

    // CREAR UNA SUBASTA desde el Mercado (botón "Crear Subasta"): proveedores (y el admin, como en las ofertas).
    // Con ofertaId, el lote sale de una de sus publicaciones (toma su título, categoría y fotos);
    // sin ofertaId, es un lote nuevo con título y categoría propios.
    router.post('/subastas', verificarToken, soloRoles('proveedor'), async (req, res) => {
        const proveedorId = req.usuario.id;
        const ofertaId = req.body.ofertaId ? Number(req.body.ofertaId) : null;
        const precioBase = Number(req.body.precioBase);
        const dias = req.body.dias === undefined || req.body.dias === '' ? DIAS_SUBASTA.porDefecto : Number(req.body.dias);
        const tituloEscrito = typeof req.body.tituloLote === 'string' ? req.body.tituloLote.trim() : '';

        if (!(precioBase > 0) || precioBase > PRECIO_MAXIMO) {
            throw new ErrorHttp(400, "El precio base debe ser un número mayor que 0.");
        }
        if (!Number.isInteger(dias) || dias < DIAS_SUBASTA.minimo || dias > DIAS_SUBASTA.maximo) {
            throw new ErrorHttp(400, `La subasta debe durar de ${DIAS_SUBASTA.minimo} a ${DIAS_SUBASTA.maximo} días.`);
        }
        if (ofertaId !== null && !(Number.isInteger(ofertaId) && ofertaId > 0)) {
            throw new ErrorHttp(400, "La publicación elegida no es válida.");
        }

        try {
            const { subastaId, fechaFin } = await enTransaccion(db, async (conn) => {
                let titulo = tituloEscrito;
                let categoriaId = Number(req.body.categoriaId) || null;
                if (ofertaId) {
                    // FOR UPDATE: dos clics seguidos no pueden abrir dos subastas de la misma publicación
                    const [[oferta]] = await conn.query(
                        'SELECT TituloMaterial, CategoriaID FROM Ofertas WHERE OfertaID = ? AND ProveedorID = ? FOR UPDATE',
                        [ofertaId, proveedorId]
                    );
                    if (!oferta) throw new ErrorHttp(404, "Esa publicación no existe o no es tuya.");
                    const [[abierta]] = await conn.query(
                        "SELECT SubastaID FROM Subastas WHERE OfertaID = ? AND Estado = 'Activa' AND FechaFin > NOW() LIMIT 1",
                        [ofertaId]
                    );
                    if (abierta) throw new ErrorHttp(409, "Esa publicación ya tiene una subasta abierta.");
                    titulo = titulo || oferta.TituloMaterial;
                    categoriaId = oferta.CategoriaID;
                }
                if (!titulo || !categoriaId) throw new ErrorHttp(400, "Escribe el título del lote y elige una categoría.");
                if (titulo.length > 120) throw new ErrorHttp(400, "El título puede tener como máximo 120 caracteres.");
                return insertarSubasta(conn, { proveedorId, ofertaId, categoriaId, titulo, precioBase, dias });
            });
            tiempoReal.aTodos('subastas:cambio', { subastaId, motivo: 'nueva' });
            res.status(201).json({
                message: `¡Subasta creada! Recibirá pujas durante ${dias} día${dias === 1 ? '' : 's'}.`,
                subastaId,
                fechaFin
            });
        } catch (err) {
            if (esCategoriaInvalida(err)) throw new ErrorHttp(400, "La categoría elegida no existe.");
            throw err;
        }
    });

    // PUJAR. Se valida y actualiza en UNA sola consulta (atómica): la subasta debe estar activa,
    // no vencida, no ser propia y la puja debe superar el precio actual.
    // Así dos pujas simultáneas no pueden dejar un precio menor.
    // El precio nuevo y el historial (tabla Pujas) se guardan en la misma transacción:
    // o se guardan los dos, o ninguno.
    router.post('/pujas', verificarToken, soloRoles('emprendedor'), async (req, res) => {
        const { subastaId } = req.body;
        const montoPuja = Number(req.body.montoPuja);
        const emprendedorId = req.usuario.id;
        if (!subastaId || !(montoPuja > 0)) {
            throw new ErrorHttp(400, "Datos de puja incompletos.");
        }

        const aceptada = await enTransaccion(db, async (conn) => {
            const [resultado] = await conn.query(`
                UPDATE Subastas
                SET PrecioActual = ?
                WHERE SubastaID = ? AND Estado = 'Activa' AND FechaFin > NOW()
                  AND PrecioActual < ? AND ProveedorID <> ?
            `, [montoPuja, subastaId, montoPuja, emprendedorId]);
            if (resultado.affectedRows === 0) return null;
            // Quién iba ganando ANTES de esta puja (el UPDATE ya bloqueó la subasta:
            // otra puja simultánea espera a que esta termine)
            const [[anterior]] = await conn.query(
                'SELECT EmprendedorID FROM Pujas WHERE SubastaID = ? ORDER BY MontoPuja DESC, FechaPuja ASC, PujaID ASC LIMIT 1',
                [subastaId]);
            await conn.query('INSERT INTO Pujas (SubastaID, EmprendedorID, MontoPuja) VALUES (?, ?, ?)', [subastaId, emprendedorId, montoPuja]);
            const [[subasta]] = await conn.query(
                `SELECT s.SubastaID, s.ProveedorID, s.TituloLote, s.PrecioActual,
                        (SELECT COUNT(*) FROM Pujas p WHERE p.SubastaID = s.SubastaID) AS totalPujas
                 FROM Subastas s WHERE s.SubastaID = ?`, [subastaId]);
            return { subasta, liderAnterior: anterior ? anterior.EmprendedorID : null };
        });

        if (!aceptada) {
            // No se aceptó: se averigua por qué para dar un mensaje claro
            const [[s]] = await db.query('SELECT PrecioActual, Estado, FechaFin, ProveedorID FROM Subastas WHERE SubastaID = ?', [subastaId]);
            if (!s) throw new ErrorHttp(404, "La subasta no existe.");
            if (s.ProveedorID === emprendedorId) throw new ErrorHttp(403, "No puedes pujar en tu propia subasta.");
            if (s.Estado === 'Cancelada') throw new ErrorHttp(409, "Esta subasta fue cancelada porque el proveedor retiró la publicación.");
            if (s.Estado !== 'Activa' || new Date(s.FechaFin) <= new Date()) throw new ErrorHttp(409, "Esta subasta ya finalizó.");
            throw new ErrorHttp(409,
                `Tu puja debe ser mayor al precio actual de C$${Number(s.PrecioActual).toLocaleString('es-NI')}.`,
                { precioActual: Number(s.PrecioActual) });
        }

        // Después de guardar: anunciar el precio nuevo y avisar a los interesados
        const { subasta, liderAnterior } = aceptada;
        const lote = nombreLote(subasta.TituloLote);
        tiempoReal.aTodos('puja:nueva', {
            subastaId: subasta.SubastaID,
            precioActual: Number(subasta.PrecioActual),
            totalPujas: Number(subasta.totalPujas)
        });
        const avisos = [{
            usuarioId: subasta.ProveedorID,
            tipo: 'PujaRecibida',
            titulo: `Nueva puja en «${lote}»`,
            mensaje: `Tu lote ya va en ${cordobas(montoPuja)} (${subasta.totalPujas} puja${Number(subasta.totalPujas) === 1 ? '' : 's'}).`,
            enlace: 'mercado.html#tab-auctions',
            referenciaId: subasta.SubastaID,
            agrupar: true
        }];
        if (liderAnterior && liderAnterior !== emprendedorId) {
            avisos.push({
                usuarioId: liderAnterior,
                tipo: 'PujaSuperada',
                titulo: `Te superaron en «${lote}»`,
                mensaje: `Alguien ofreció ${cordobas(montoPuja)}. Puja de nuevo antes de que cierre la subasta.`,
                enlace: 'mercado.html#tab-auctions',
                referenciaId: subasta.SubastaID,
                agrupar: true,
                correo: {
                    asunto: `Te superaron en la subasta: ${lote}`,
                    titulo: 'Alguien superó tu puja',
                    parrafos: [
                        `En la subasta «${lote}» ahora hay una puja de ${cordobas(montoPuja)}.`,
                        'Si todavía te interesa el lote, entra al Mercado y vuelve a pujar antes de que cierre.'
                    ],
                    textoBoton: 'Ir a las subastas'
                }
            });
        }
        await notificaciones.enviar(avisos);

        res.json({ message: "¡Tu puja ha sido aceptada exitosamente!" });
    });

    return router;
}

module.exports = crearRutasSubastas;
