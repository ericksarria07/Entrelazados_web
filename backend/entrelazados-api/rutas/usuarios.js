// ==========================================================================
// PERFILES Y REPUTACIÓN. Se monta en /api
//   GET /api/perfil/:id                 perfil completo (el propio, o cualquiera si eres admin)  🔒
//   GET /api/usuarios/:id/reputacion    promedio, total y últimas calificaciones recibidas      🔒
//   GET /api/usuarios/:id/publico       perfil PÚBLICO (sin sesión): lo que se puede compartir
//   GET /api/usuarios/:id/resenas       reseñas recibidas, paginadas (?pagina=&porPagina=), sin sesión
// El perfil público nunca trae correo, teléfono, dirección ni RUC. Solo existe para
// proveedores y emprendedores con la cuenta activa (a cualquier otro se le responde 404).
// ==========================================================================
const express = require('express');
const { ErrorHttp, enteroPositivo, leerPaginacion, respuestaPaginada, redondearCalificacion } = require('../utilidades');

const NO_ENCONTRADO = 'Ese perfil no existe o no está disponible.';

function crearRutasUsuarios({ db, tratos, verificarToken }) {
    const router = express.Router();

    router.get('/perfil/:id', verificarToken, async (req, res) => {
        const usuarioId = req.params.id;
        // Cada usuario solo puede ver su propio perfil completo (correo, teléfono, RUC...)
        if (Number(usuarioId) !== req.usuario.id && !req.usuario.esAdmin) {
            throw new ErrorHttp(403, "No tienes permiso para ver este perfil.");
        }
        const [[perfil]] = await db.query(`
            SELECT
                u.UsuarioID, u.CorreoElectronico, u.TipoRol, u.EstadoCuenta,
                p.NombreRazonSocial, p.TelefonoWhatsApp, d.NombreDepartamento,
                prov.NumeroRUC, prov.NombreComercial, prov.TipoMateriaPrimaPrincipal, prov.DescripcionEmpresa,
                emp.NombreMarca, emp.EspecialidadCalzado, emp.CapacidadProduccionMensual,
                adm.NivelAcceso
            FROM Usuarios u
            LEFT JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
            LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
            LEFT JOIN Proveedores prov ON u.UsuarioID = prov.UsuarioID
            LEFT JOIN Emprendedores emp ON u.UsuarioID = emp.UsuarioID
            LEFT JOIN Administradores adm ON u.UsuarioID = adm.UsuarioID
            WHERE u.UsuarioID = ?
        `, [usuarioId]);
        if (!perfil) throw new ErrorHttp(404, "Usuario no encontrado.");
        res.json(perfil);
    });

    router.get('/usuarios/:id/reputacion', verificarToken, async (req, res) => {
        const usuarioId = enteroPositivo(req.params.id);
        if (!usuarioId) throw new ErrorHttp(404, 'Usuario no encontrado.');
        res.json(await tratos.reputacion(usuarioId));
    });

    // ---------------------------------------------------------------- PERFIL PÚBLICO
    // Proveedor o emprendedor con la cuenta activa; si no, 404 (no se dice si existe)
    async function usuarioPublico(id) {
        const usuarioId = enteroPositivo(id);
        if (!usuarioId) throw new ErrorHttp(404, NO_ENCONTRADO);
        const [[u]] = await db.query(`
            SELECT u.UsuarioID, u.TipoRol, u.FechaRegistro,
                   p.NombreRazonSocial, d.NombreDepartamento,
                   prov.NombreComercial, prov.DescripcionEmpresa, prov.TipoMateriaPrimaPrincipal,
                   emp.NombreMarca, emp.EspecialidadCalzado
            FROM Usuarios u
            LEFT JOIN PerfilesUsuarios p ON p.UsuarioID = u.UsuarioID
            LEFT JOIN Departamentos d ON d.DepartamentoID = p.DepartamentoID
            LEFT JOIN Proveedores prov ON prov.UsuarioID = u.UsuarioID
            LEFT JOIN Emprendedores emp ON emp.UsuarioID = u.UsuarioID
            WHERE u.UsuarioID = ? AND u.EstadoCuenta = 'Activo'
              AND LOWER(u.TipoRol) IN ('proveedor', 'emprendedor')`, [usuarioId]);
        if (!u) throw new ErrorHttp(404, NO_ENCONTRADO);
        return u;
    }

    router.get('/usuarios/:id/publico', async (req, res) => {
        const u = await usuarioPublico(req.params.id);
        const id = u.UsuarioID;
        const esProveedor = u.TipoRol.toLowerCase() === 'proveedor';
        const [[[cuentas]], [estrellas]] = await Promise.all([
            db.query(`
                SELECT (SELECT COUNT(*) FROM Ofertas WHERE ProveedorID = ?) AS publicaciones,
                       (SELECT COUNT(*) FROM Subastas WHERE ProveedorID = ? AND Estado = 'Activa' AND FechaFin > NOW()) AS subastasActivas,
                       (SELECT COUNT(*) FROM TratosCerrados WHERE (ProveedorID = ? OR EmprendedorID = ?) AND EstadoTrato = 'Completado') AS tratosCompletados`,
                [id, id, id, id]),
            db.query('SELECT Puntuacion AS puntuacion, COUNT(*) AS total FROM Calificaciones WHERE CalificadoID = ? GROUP BY Puntuacion', [id])
        ]);
        // Cuántas calificaciones hay de cada estrella (5 a 1), para las barras de la página
        const distribucion = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        let total = 0, suma = 0;
        for (const e of estrellas) {
            const n = Number(e.total);
            distribucion[e.puntuacion] = n;
            total += n;
            suma += n * e.puntuacion;
        }
        res.json({
            id,
            rol: esProveedor ? 'Proveedor' : 'Emprendedor',
            nombre: u.NombreRazonSocial || 'Usuario',
            departamento: u.NombreDepartamento || null,
            miembroDesde: u.FechaRegistro,
            // Proveedor: nombre comercial, qué vende y la descripción de su empresa
            nombreComercial: esProveedor ? u.NombreComercial || null : null,
            materiaPrincipal: esProveedor ? u.TipoMateriaPrimaPrincipal || null : null,
            descripcion: esProveedor ? u.DescripcionEmpresa || null : null,
            // Emprendedor: su marca y qué calzado hace
            marca: esProveedor ? null : u.NombreMarca || null,
            especialidad: esProveedor ? null : u.EspecialidadCalzado || null,
            estadisticas: {
                publicaciones: esProveedor ? Number(cuentas.publicaciones) : 0,
                subastasActivas: esProveedor ? Number(cuentas.subastasActivas) : 0,
                tratosCompletados: Number(cuentas.tratosCompletados)
            },
            reputacion: { total, promedio: total ? redondearCalificacion(suma / total) : null, distribucion }
        });
    });

    router.get('/usuarios/:id/resenas', async (req, res) => {
        const u = await usuarioPublico(req.params.id);
        const pag = leerPaginacion({ porPagina: 5, ...req.query, pagina: req.query.pagina || 1 }, 5, 20);
        const [[filas], [[{ total }]]] = await Promise.all([
            db.query(`
                SELECT c.CalificacionID AS id, c.Puntuacion AS puntuacion, c.Comentario AS comentario,
                       c.FechaCalificacion AS fecha, COALESCE(p.NombreRazonSocial, 'Usuario') AS autor
                FROM Calificaciones c
                LEFT JOIN PerfilesUsuarios p ON p.UsuarioID = c.AutorID
                WHERE c.CalificadoID = ?
                ORDER BY c.FechaCalificacion DESC, c.CalificacionID DESC
                LIMIT ? OFFSET ?`, [u.UsuarioID, pag.porPagina, pag.offset]),
            db.query('SELECT COUNT(*) AS total FROM Calificaciones WHERE CalificadoID = ?', [u.UsuarioID])
        ]);
        res.json(respuestaPaginada(filas, Number(total), pag));
    });

    return router;
}

module.exports = crearRutasUsuarios;
