// ==========================================================================
// FAVORITOS Y ALERTAS DE BÚSQUEDA
//
// FAVORITOS: cualquier usuario guarda publicaciones con el corazón (menos las
// suyas). Si una publicación guardada baja de precio, quien la guardó recibe
// una notificación ("FavoritoRebajado").
//
// ALERTAS: "avísame cuando publiquen <palabra> en <categoría> por menos de
// C$<precio>". Cada campo es opcional, pero hace falta la palabra o la
// categoría. Cuando un proveedor publica algo que cumple, la persona recibe
// una notificación en la campana y un correo ("AlertaBusqueda").
//
// Los avisos salen DESPUÉS de guardar la publicación y nunca la hacen fallar
// (notificaciones.enviar no lanza errores).
// ==========================================================================
const { ErrorHttp, enteroPositivo, textoLimpio, redondearCalificacion } = require('../utilidades');
const { PRECIO_MAXIMO } = require('./ofertas');
const { notificacionesNulas } = require('./notificaciones');

const MAX_ALERTAS = 10;
const LARGO_PALABRA = 60;

// "Cuero CAFÉ " -> "cuero cafe": las alertas no distinguen mayúsculas ni tildes
const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Valida lo que llega del formulario de alertas. Devuelve { error } o los datos limpios.
function validarAlerta(body = {}) {
    const palabra = textoLimpio(body.palabraClave).replace(/\s+/g, ' ');
    const vacio = (v) => v === undefined || v === null || v === '' || v === 'todos';
    const categoriaId = vacio(body.categoriaId) ? null : enteroPositivo(body.categoriaId);
    const sinPrecio = vacio(body.precioMaximo);
    const precioMaximo = sinPrecio ? null : Number(body.precioMaximo);

    if (!vacio(body.categoriaId) && !categoriaId) return { error: 'La categoría elegida no es válida.' };
    if (!palabra && !categoriaId) return { error: 'Escribe una palabra clave o elige una categoría para la alerta.' };
    if (palabra.length > LARGO_PALABRA) return { error: `La palabra clave puede tener como máximo ${LARGO_PALABRA} caracteres.` };
    if (!sinPrecio && (!(precioMaximo > 0) || precioMaximo > PRECIO_MAXIMO)) return { error: 'El precio máximo debe ser un número mayor que 0.' };
    return { palabraClave: palabra || null, categoriaId, precioMaximo };
}

// ¿La publicación cumple la alerta? (la categoría y el precio ya los filtra SQL, pero
// se revisan otra vez para poder probar la regla completa sin base de datos)
function cumpleAlerta(alerta, oferta) {
    if (alerta.CategoriaID && Number(alerta.CategoriaID) !== Number(oferta.categoriaId)) return false;
    if (alerta.PrecioMaximo !== null && alerta.PrecioMaximo !== undefined && Number(oferta.precio) > Number(alerta.PrecioMaximo)) return false;
    if (alerta.PalabraClave) {
        const texto = normalizar(`${oferta.titulo} ${oferta.descripcion || ''}`);
        // Todas las palabras deben aparecer, en cualquier orden: "cuero cafe" encuentra "Cuero vacuno café"
        if (!normalizar(alerta.PalabraClave).split(' ').every(p => texto.includes(p))) return false;
    }
    return true;
}

// Texto corto que describe una alerta: «cuero» en Suelas, hasta C$500
function describirAlerta(a) {
    const partes = [];
    if (a.PalabraClave) partes.push(`«${a.PalabraClave}»`);
    if (a.NombreCategoria) partes.push(`en ${a.NombreCategoria}`);
    if (a.PrecioMaximo !== null && a.PrecioMaximo !== undefined) partes.push(`hasta C$${Number(a.PrecioMaximo).toLocaleString('es-NI')}`);
    return partes.join(' ');
}

const dinero = (n) => `C$${Number(n).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function crearServicioFavoritos({ db, notificaciones = notificacionesNulas, ofertas = null }) {

    // ---------------------------------------------------------------- FAVORITOS
    async function idsFavoritos(usuarioId) {
        const [filas] = await db.query('SELECT OfertaID FROM Favoritos WHERE UsuarioID = ?', [usuarioId]);
        return filas.map(f => f.OfertaID);
    }

    // Publicaciones guardadas, con los mismos campos que GET /api/ofertas
    async function listarFavoritos(usuarioId) {
        const [filas] = await db.query(`
            SELECT o.OfertaID, o.ProveedorID, o.TituloMaterial, o.Descripcion, o.Precio, o.UnidadMedida,
                   o.DistanciaSimuladaKm, o.CategoriaID, c.NombreCategoria, o.FechaPublicacion, f.FechaGuardado,
                   COALESCE(pr.NombreRazonSocial, 'Proveedor') AS NombreProveedor,
                   cal.Promedio AS CalificacionProveedor, COALESCE(cal.Total, 0) AS TotalCalificaciones
            FROM Favoritos f
            JOIN Ofertas o ON o.OfertaID = f.OfertaID
            JOIN CategoriasMateriales c ON c.CategoriaID = o.CategoriaID
            LEFT JOIN PerfilesUsuarios pr ON pr.UsuarioID = o.ProveedorID
            LEFT JOIN (SELECT CalificadoID, AVG(Puntuacion) AS Promedio, COUNT(*) AS Total
                       FROM Calificaciones GROUP BY CalificadoID) cal ON cal.CalificadoID = o.ProveedorID
            WHERE f.UsuarioID = ?
            ORDER BY f.FechaGuardado DESC, o.OfertaID DESC
            LIMIT 100`, [usuarioId]);
        const fotos = ofertas ? await ofertas.urlsDeFotos(filas.map(o => o.OfertaID)) : new Map();
        return filas.map(o => ({
            ...o,
            Fotos: fotos.get(o.OfertaID) || [],
            CalificacionProveedor: redondearCalificacion(o.CalificacionProveedor),
            TotalCalificaciones: Number(o.TotalCalificaciones)
        }));
    }

    async function agregarFavorito(usuarioId, ofertaId) {
        const id = enteroPositivo(ofertaId);
        const [[oferta]] = id ? await db.query('SELECT OfertaID, ProveedorID FROM Ofertas WHERE OfertaID = ?', [id]) : [[]];
        if (!oferta) throw new ErrorHttp(404, 'Esa publicación ya no existe.');
        if (oferta.ProveedorID === usuarioId) throw new ErrorHttp(400, 'No puedes guardar tu propia publicación en favoritos.');
        const [r] = await db.query('INSERT IGNORE INTO Favoritos (UsuarioID, OfertaID) VALUES (?, ?)', [usuarioId, id]);
        return { ofertaId: id, nuevo: r.affectedRows > 0 };
    }

    async function quitarFavorito(usuarioId, ofertaId) {
        const id = enteroPositivo(ofertaId);
        if (!id) return false;
        const [r] = await db.query('DELETE FROM Favoritos WHERE UsuarioID = ? AND OfertaID = ?', [usuarioId, id]);
        return r.affectedRows > 0;
    }

    // ---------------------------------------------------------------- ALERTAS
    async function listarAlertas(usuarioId) {
        const [filas] = await db.query(`
            SELECT a.AlertaID, a.PalabraClave, a.CategoriaID, c.NombreCategoria, a.PrecioMaximo, a.FechaCreacion
            FROM AlertasBusqueda a LEFT JOIN CategoriasMateriales c ON c.CategoriaID = a.CategoriaID
            WHERE a.UsuarioID = ? ORDER BY a.FechaCreacion DESC, a.AlertaID DESC`, [usuarioId]);
        return filas.map(a => ({
            id: a.AlertaID,
            palabraClave: a.PalabraClave,
            categoriaId: a.CategoriaID,
            categoria: a.NombreCategoria,
            precioMaximo: a.PrecioMaximo === null ? null : Number(a.PrecioMaximo),
            descripcion: describirAlerta(a),
            fecha: a.FechaCreacion
        }));
    }

    async function crearAlerta(usuarioId, body) {
        const datos = validarAlerta(body);
        if (datos.error) throw new ErrorHttp(400, datos.error);
        const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM AlertasBusqueda WHERE UsuarioID = ?', [usuarioId]);
        if (Number(total) >= MAX_ALERTAS) {
            throw new ErrorHttp(409, `Puedes tener como máximo ${MAX_ALERTAS} alertas. Borra alguna antes de crear otra.`);
        }
        const [[repetida]] = await db.query(
            `SELECT AlertaID FROM AlertasBusqueda WHERE UsuarioID = ? AND PalabraClave <=> ? AND CategoriaID <=> ? AND PrecioMaximo <=> ?`,
            [usuarioId, datos.palabraClave, datos.categoriaId, datos.precioMaximo]);
        if (repetida) throw new ErrorHttp(409, 'Ya tienes una alerta igual.');
        try {
            const [r] = await db.query(
                'INSERT INTO AlertasBusqueda (UsuarioID, PalabraClave, CategoriaID, PrecioMaximo) VALUES (?, ?, ?, ?)',
                [usuarioId, datos.palabraClave, datos.categoriaId, datos.precioMaximo]);
            return (await listarAlertas(usuarioId)).find(a => a.id === r.insertId);
        } catch (err) {
            if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
                throw new ErrorHttp(400, 'La categoría elegida no existe.');
            }
            throw err;
        }
    }

    async function borrarAlerta(usuarioId, alertaId) {
        const id = enteroPositivo(alertaId);
        if (!id) return false;
        const [r] = await db.query('DELETE FROM AlertasBusqueda WHERE AlertaID = ? AND UsuarioID = ?', [id, usuarioId]);
        return r.affectedRows > 0;
    }

    // ---------------------------------------------------------------- AVISOS
    // Se publicó algo nuevo: avisar a quienes tienen una alerta que lo cumple
    // (una sola notificación por persona aunque cumpla varias de sus alertas).
    // oferta: { ofertaId, proveedorId, titulo, descripcion, categoriaId, precio }
    async function avisarNuevaPublicacion(oferta) {
        try {
            const [alertas] = await db.query(`
                SELECT a.AlertaID, a.UsuarioID, a.PalabraClave, a.CategoriaID, a.PrecioMaximo, c.NombreCategoria
                FROM AlertasBusqueda a
                JOIN Usuarios u ON u.UsuarioID = a.UsuarioID AND u.EstadoCuenta = 'Activo'
                LEFT JOIN CategoriasMateriales c ON c.CategoriaID = a.CategoriaID
                WHERE a.UsuarioID <> ?
                  AND (a.CategoriaID IS NULL OR a.CategoriaID = ?)
                  AND (a.PrecioMaximo IS NULL OR a.PrecioMaximo >= ?)`,
                [oferta.proveedorId, oferta.categoriaId, oferta.precio]);
            const porUsuario = new Map();
            for (const a of alertas) {
                if (!porUsuario.has(a.UsuarioID) && cumpleAlerta(a, oferta)) porUsuario.set(a.UsuarioID, a);
            }
            if (porUsuario.size === 0) return 0;
            const titulo = `Nueva publicación: ${oferta.titulo}`.slice(0, 120);
            const precio = dinero(oferta.precio);
            await notificaciones.enviar([...porUsuario.values()].map(a => ({
                usuarioId: a.UsuarioID,
                tipo: 'AlertaBusqueda',
                referenciaId: oferta.ofertaId,
                titulo,
                mensaje: `Cumple tu alerta ${describirAlerta(a)}. Precio: ${precio}.`,
                enlace: `mercado.html?oferta=${oferta.ofertaId}`,
                correo: {
                    asunto: `Se publicó «${oferta.titulo}» en EntreLazados`,
                    titulo: 'Se publicó algo que estabas buscando',
                    parrafos: [`«${oferta.titulo}» por ${precio}.`, `Cumple tu alerta ${describirAlerta(a)}.`],
                    textoBoton: 'Ver la publicación'
                }
            })));
            return porUsuario.size;
        } catch (err) {
            console.error('⚠️ No se pudieron revisar las alertas de búsqueda:', err.message);
            return 0;
        }
    }

    // Una publicación bajó de precio: avisar a quienes la guardaron (menos a su dueño)
    async function avisarRebaja({ ofertaId, proveedorId, titulo, precioAnterior, precioNuevo }) {
        if (!(Number(precioNuevo) < Number(precioAnterior))) return 0;
        try {
            const [filas] = await db.query(
                'SELECT UsuarioID FROM Favoritos WHERE OfertaID = ? AND UsuarioID <> ?', [ofertaId, proveedorId]);
            if (filas.length === 0) return 0;
            await notificaciones.enviar(filas.map(f => ({
                usuarioId: f.UsuarioID,
                tipo: 'FavoritoRebajado',
                referenciaId: ofertaId,
                agrupar: true,
                titulo: `Bajó de precio: ${titulo}`.slice(0, 120),
                mensaje: `Una publicación que guardaste pasó de ${dinero(precioAnterior)} a ${dinero(precioNuevo)}.`,
                enlace: `mercado.html?oferta=${ofertaId}`
            })));
            return filas.length;
        } catch (err) {
            console.error('⚠️ No se pudo avisar la rebaja de precio:', err.message);
            return 0;
        }
    }

    return {
        idsFavoritos, listarFavoritos, agregarFavorito, quitarFavorito,
        listarAlertas, crearAlerta, borrarAlerta,
        avisarNuevaPublicacion, avisarRebaja
    };
}

// Versión que no hace nada (pruebas sin base de datos)
const favoritosNulos = {
    idsFavoritos: async () => [],
    listarFavoritos: async () => [],
    agregarFavorito: async () => { throw new ErrorHttp(503, 'Favoritos no disponibles.'); },
    quitarFavorito: async () => false,
    listarAlertas: async () => [],
    crearAlerta: async () => { throw new ErrorHttp(503, 'Alertas no disponibles.'); },
    borrarAlerta: async () => false,
    avisarNuevaPublicacion: async () => 0,
    avisarRebaja: async () => 0
};

module.exports = { crearServicioFavoritos, favoritosNulos, validarAlerta, cumpleAlerta, describirAlerta, normalizar, MAX_ALERTAS };
