// ==========================================================================
// PERFIL Y REPUTACIÓN (piden sesión). Se monta en /api
//   GET /api/perfil/:id                 perfil completo (el propio, o cualquiera si eres admin)
//   GET /api/usuarios/:id/reputacion    promedio, total y últimas calificaciones recibidas
// ==========================================================================
const express = require('express');
const { ErrorHttp, enteroPositivo } = require('../utilidades');

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

    return router;
}

module.exports = crearRutasUsuarios;
