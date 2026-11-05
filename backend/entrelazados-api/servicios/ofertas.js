// ==========================================================================
// OFERTAS (publicaciones) Y SUS SUBASTAS
//
// Lo que usan varias rutas: validar una publicación, leer sus fotos, crear
// el lote en subasta y borrar una publicación (la borra su dueño o el admin).
// ==========================================================================
const fotos = require('./fotos');
const { avisarPujadoresCancelacion } = require('./subastas');
const { enTransaccion } = require('../db');
const { enteroPositivo } = require('../utilidades');

// Duración permitida de una subasta y precio máximo (DECIMAL(10,2) llega hasta 99.999.999,99)
const DIAS_SUBASTA = { minimo: 1, maximo: 14, porDefecto: 7 };
const PRECIO_MAXIMO = 99999999;
const MOTIVO_MODERACION = 'por moderación del administrador';
const LARGO_DESCRIPCION = 1000;

// Valida los campos de una publicación (al crearla y al editarla).
// Devuelve { error } o los datos ya limpios.
function validarOferta(body) {
    const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
    const unidad = typeof body.unidad === 'string' ? body.unidad.trim() : '';
    const precio = Number(body.precio);
    const categoriaId = enteroPositivo(body.categoriaId);
    if (!titulo || !body.precio || !unidad || !categoriaId) return { error: "Por favor, llena todos los campos obligatorios." };
    if (titulo.length > 120) return { error: "El título puede tener como máximo 120 caracteres." };
    if (unidad.length > 30) return { error: "La unidad de medida puede tener como máximo 30 caracteres." };
    if (!(precio > 0) || precio > PRECIO_MAXIMO) return { error: "El precio debe ser un número mayor que 0." };
    // Descripción opcional (la puede redactar el asistente de IA); vacía se guarda como NULL
    const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
    if (descripcion.length > LARGO_DESCRIPCION) return { error: `La descripción puede tener como máximo ${LARGO_DESCRIPCION} caracteres.` };
    const distancia = Math.max(0, Math.min(10000, Math.round(Number(body.distancia) || 0)));
    return { titulo, unidad, precio, categoriaId, distancia, descripcion: descripcion || null };
}

// MySQL rechaza la llave foránea cuando la categoría elegida no existe
const esCategoriaInvalida = (err) => err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW';

// Las fotos nuevas están en la tabla FotosOfertas (archivos en disco, ver fotos.js).
// Las ofertas antiguas guardaban sus fotos como texto JSON en Ofertas.Fotos:
// se siguen mostrando mientras no tengan fotos en la tabla.
function leerFotosAntiguas(valor) {
    try {
        const lista = valor ? JSON.parse(valor) : [];
        return Array.isArray(lista) ? lista.filter(f => typeof f === 'string') : [];
    } catch (e) {
        return [];
    }
}

// Crea una subasta dentro de una transacción ya abierta (conn).
// ofertaId liga el lote a su publicación: así muestra sus fotos y se cancela si la publicación se borra.
async function insertarSubasta(conn, { proveedorId, ofertaId = null, categoriaId, titulo, precioBase, dias = DIAS_SUBASTA.porDefecto }) {
    const fechaFin = new Date();
    fechaFin.setDate(fechaFin.getDate() + dias);
    const [resultado] = await conn.query(
        `INSERT INTO Subastas (ProveedorID, OfertaID, CategoriaID, TituloLote, PrecioBase, PrecioActual, FechaFin, Estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Activa')`,
        [proveedorId, ofertaId, categoriaId, `Lote Subasta: ${titulo}`, precioBase, precioBase, fechaFin]
    );
    return { subastaId: resultado.insertId, fechaFin };
}

// Texto de respuesta después de borrar una publicación
function mensajeOfertaBorrada(resultado, base) {
    let texto = base;
    if (resultado.subastasCanceladas > 0) texto += ' Su subasta abierta también se canceló.';
    if (resultado.pujadoresAvisados > 0) texto += ` Avisamos por el chat a ${resultado.pujadoresAvisados} persona(s) que habían pujado.`;
    return texto;
}

function crearServicioOfertas({ db, cierreSubastas, tiempoReal = { aTodos() { } } }) {
    // Direcciones de las fotos (en disco) de las ofertas indicadas: Map(OfertaID -> [url, ...])
    async function urlsDeFotos(ofertaIds) {
        if (!ofertaIds.length) return new Map();
        const [filas] = await db.query(
            'SELECT OfertaID, FotoURL FROM FotosOfertas WHERE OfertaID IN (?) ORDER BY EsPrincipal DESC, FotoID',
            [ofertaIds]
        );
        const mapa = new Map();
        for (const f of filas) {
            if (!mapa.has(f.OfertaID)) mapa.set(f.OfertaID, []);
            mapa.get(f.OfertaID).push(f.FotoURL);
        }
        return mapa;
    }

    // Borra una oferta con sus fotos (de la tabla y del disco) y cancela su subasta si sigue abierta.
    // Si se indica proveedorId, solo la borra si es de ese proveedor, y NO la borra si su
    // subasta abierta ya tiene pujas (no se le quita el lote a quien va ganando).
    // El admin (sin proveedorId) sí puede: la subasta queda 'Cancelada' igual.
    // Las subastas ya vencidas no se tocan: el cierre automático les da su ganador.
    // Si la borra el admin (moderadorId) y la subasta tenía pujas, se avisa a quienes pujaron.
    // Devuelve { borrada, pujas, subastasCanceladas, pujadoresAvisados }.
    async function eliminarOferta(ofertaId, { proveedorId = null, moderadorId = null } = {}) {
        const soloDelProveedor = proveedorId !== null;
        const noBorrada = (pujas = 0) => ({ borrada: false, pujas, subastasCanceladas: 0, pujadoresAvisados: 0 });

        const resultado = await enTransaccion(db, async (conn) => {
            const [[oferta]] = await conn.query(
                `SELECT OfertaID FROM Ofertas WHERE OfertaID = ? ${soloDelProveedor ? 'AND ProveedorID = ?' : ''} FOR UPDATE`,
                soloDelProveedor ? [ofertaId, proveedorId] : [ofertaId]
            );
            if (!oferta) return noBorrada();

            // FOR UPDATE: una puja que llegue mientras tanto espera y luego ve la subasta cancelada
            const [abiertas] = await conn.query(
                `SELECT s.SubastaID, (SELECT COUNT(*) FROM Pujas p WHERE p.SubastaID = s.SubastaID) AS pujas
                 FROM Subastas s
                 WHERE s.OfertaID = ? AND s.Estado = 'Activa' AND s.FechaFin > NOW()
                 FOR UPDATE`,
                [ofertaId]
            );
            const pujas = abiertas.reduce((total, s) => total + Number(s.pujas), 0);
            // Sin cambios: al devolver aquí, enTransaccion confirma una transacción vacía
            if (soloDelProveedor && pujas > 0) return noBorrada(pujas);

            let avisos = [];
            if (abiertas.length > 0) {
                await conn.query("UPDATE Subastas SET Estado = 'Cancelada' WHERE SubastaID IN (?)", [abiertas.map(s => s.SubastaID)]);
                if (moderadorId && pujas > 0) {
                    avisos = await avisarPujadoresCancelacion(conn, {
                        subastaIds: abiertas.filter(s => Number(s.pujas) > 0).map(s => s.SubastaID),
                        remitenteId: moderadorId,
                        motivo: MOTIVO_MODERACION
                    });
                }
            }

            const [filasFotos] = await conn.query('SELECT FotoURL FROM FotosOfertas WHERE OfertaID = ?', [ofertaId]);
            // Las filas de FotosOfertas se borran en cascada; las subastas conservan su historial (OfertaID = NULL)
            await conn.query('DELETE FROM Ofertas WHERE OfertaID = ?', [ofertaId]);
            return {
                borrada: true,
                pujas: 0,
                subastasCanceladas: abiertas.length,
                pujadoresAvisados: new Set(avisos.map(a => a.emprendedorId)).size,
                urlsFotos: filasFotos.map(f => f.FotoURL),
                avisos
            };
        });

        if (!resultado.borrada) return resultado;
        // Después del COMMIT: borrar los archivos y avisar por correo (sin bloquear la respuesta)
        const { urlsFotos, avisos, ...respuesta } = resultado;
        await fotos.borrarFotos(urlsFotos);
        if (respuesta.subastasCanceladas > 0) tiempoReal.aTodos('subastas:cambio', { motivo: 'cancelada' });
        await cierreSubastas.avisarCancelacion(avisos, MOTIVO_MODERACION);
        return respuesta;
    }

    return { urlsDeFotos, eliminarOferta };
}

module.exports = {
    crearServicioOfertas,
    validarOferta,
    esCategoriaInvalida,
    leerFotosAntiguas,
    insertarSubasta,
    mensajeOfertaBorrada,
    DIAS_SUBASTA,
    PRECIO_MAXIMO,
    LARGO_DESCRIPCION
};
