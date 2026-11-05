// ==========================================================================
// MAPA DE PROVEEDORES (pide sesión). Se monta en /api/mapa
//   GET /api/mapa/proveedores?categoria=ID
//
// Agrupa a los proveedores activos por el departamento de su perfil y le pone
// a cada grupo las coordenadas de la cabecera departamental (servicios/departamentos.js).
// Con ?categoria= solo aparecen los que tienen publicaciones de esa categoría.
// Quienes escribieron un departamento que no se reconoce van en "sinUbicacion".
// No se envían correos ni teléfonos: para hablar con un proveedor está el chat.
// ==========================================================================
const express = require('express');
const { ubicarDepartamento } = require('../servicios/departamentos');
const { enteroPositivo, redondearCalificacion } = require('../utilidades');

function crearRutasMapa({ db, verificarToken }) {
    const router = express.Router();

    router.get('/proveedores', verificarToken, async (req, res) => {
        const categoria = enteroPositivo(req.query.categoria);
        const filtro = categoria ? 'AND o.CategoriaID = ?' : '';
        const [filas] = await db.query(`
            SELECT u.UsuarioID, p.NombreRazonSocial, prov.NombreComercial, prov.TipoMateriaPrimaPrincipal,
                   d.NombreDepartamento,
                   COUNT(DISTINCT o.OfertaID) AS ofertas,
                   GROUP_CONCAT(DISTINCT c.NombreCategoria ORDER BY c.NombreCategoria SEPARATOR '|') AS categorias,
                   cal.Promedio, COALESCE(cal.Total, 0) AS TotalCalificaciones
            FROM Usuarios u
            JOIN PerfilesUsuarios p ON p.UsuarioID = u.UsuarioID
            LEFT JOIN Departamentos d ON d.DepartamentoID = p.DepartamentoID
            LEFT JOIN Proveedores prov ON prov.UsuarioID = u.UsuarioID
            LEFT JOIN Ofertas o ON o.ProveedorID = u.UsuarioID ${filtro}
            LEFT JOIN CategoriasMateriales c ON c.CategoriaID = o.CategoriaID
            LEFT JOIN (SELECT CalificadoID, AVG(Puntuacion) AS Promedio, COUNT(*) AS Total
                       FROM Calificaciones GROUP BY CalificadoID) cal ON cal.CalificadoID = u.UsuarioID
            WHERE LOWER(u.TipoRol) = 'proveedor' AND u.EstadoCuenta = 'Activo'
            GROUP BY u.UsuarioID, p.NombreRazonSocial, prov.NombreComercial, prov.TipoMateriaPrimaPrincipal,
                     d.NombreDepartamento, cal.Promedio, cal.Total
            ${categoria ? 'HAVING ofertas > 0' : ''}
            ORDER BY ofertas DESC, p.NombreRazonSocial`, categoria ? [categoria] : []);

        const grupos = new Map();
        const sinUbicacion = [];
        for (const f of filas) {
            const proveedor = {
                id: f.UsuarioID,
                nombre: f.NombreComercial || f.NombreRazonSocial,
                razonSocial: f.NombreRazonSocial,
                especialidad: f.TipoMateriaPrimaPrincipal || null,
                ofertas: Number(f.ofertas),
                categorias: f.categorias ? f.categorias.split('|') : [],
                calificacion: redondearCalificacion(f.Promedio),
                totalCalificaciones: Number(f.TotalCalificaciones),
                departamentoEscrito: f.NombreDepartamento || null
            };
            const ubicacion = ubicarDepartamento(f.NombreDepartamento);
            if (!ubicacion) { sinUbicacion.push(proveedor); continue; }
            if (!grupos.has(ubicacion.nombre)) grupos.set(ubicacion.nombre, { departamento: ubicacion.nombre, lat: ubicacion.lat, lng: ubicacion.lng, proveedores: [] });
            grupos.get(ubicacion.nombre).proveedores.push(proveedor);
        }

        // Dónde está quien mira el mapa (para centrarlo y marcar "tu departamento")
        const [[yo]] = await db.query(
            `SELECT d.NombreDepartamento FROM PerfilesUsuarios p
             LEFT JOIN Departamentos d ON d.DepartamentoID = p.DepartamentoID WHERE p.UsuarioID = ?`, [req.usuario.id]);
        const departamentos = [...grupos.values()].sort((a, b) => b.proveedores.length - a.proveedores.length);
        res.json({
            total: filas.length,
            departamentos,
            sinUbicacion,
            miUbicacion: yo ? ubicarDepartamento(yo.NombreDepartamento) : null
        });
    });

    return router;
}

module.exports = crearRutasMapa;
