// ==========================================================================
// DASHBOARD: GET /api/dashboard?meses=3|6|12  (pide sesión)
// En una sola llamada: estadísticas de la plataforma, gráficas, subastas en
// curso, pujas recientes y la actividad propia según el rol.
// Las consultas independientes se hacen en paralelo (Promise.all).
// ==========================================================================
const express = require('express');
const { redondearCalificacion } = require('../utilidades');

const PERIODOS = [3, 6, 12];
const CAMPOS_DE_TEXTO = ['categoria', 'departamento', 'lote', 'proveedor', 'mes', 'rol', 'postor'];

// mysql2 devuelve DECIMAL y SUM como texto: se convierten a número (menos los campos de texto)
const aNumeros = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) =>
    [k, (typeof v === 'string' && v !== '' && !isNaN(v) && !CAMPOS_DE_TEXTO.includes(k)) ? Number(v) : v]));

// Primer día del mes de inicio del periodo (ej. 6 meses = mes actual + 5 anteriores)
function inicioDelPeriodo(meses) {
    const inicio = new Date();
    inicio.setDate(1);
    inicio.setHours(0, 0, 0, 0);
    inicio.setMonth(inicio.getMonth() - (meses - 1));
    return inicio;
}

// Serie mes a mes (incluye los meses sin actividad, en 0)
function serieMensual(filas, inicio, meses) {
    const serie = [];
    for (let i = 0; i < meses; i++) {
        const f = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
        const clave = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
        const fila = { mes: clave, registros: 0, ofertas: 0, pujas: 0 };
        filas.filter(a => a.mes === clave).forEach(a => { fila[a.tipo] = Number(a.total); });
        serie.push(fila);
    }
    return serie;
}

function crearRutasDashboard({ db, verificarToken }) {
    const router = express.Router();
    const consulta = async (sql, params = []) => (await db.query(sql, params))[0];

    // ACTIVIDAD PROPIA SEGÚN EL ROL
    async function actividadPropia(usuario) {
        const yo = usuario.id;
        const mia = { rol: usuario.rol };
        const p7 = Array(7).fill(yo);
        if (usuario.rol === 'proveedor') {
            const [m] = await consulta(`
                SELECT
                    (SELECT COUNT(*) FROM Ofertas WHERE ProveedorID = ?) AS misOfertas,
                    (SELECT COUNT(*) FROM Subastas WHERE ProveedorID = ? AND Estado = 'Activa' AND FechaFin > NOW()) AS misSubastasActivas,
                    (SELECT COUNT(*) FROM Pujas pj JOIN Subastas s ON s.SubastaID = pj.SubastaID WHERE s.ProveedorID = ?) AS pujasRecibidas,
                    (SELECT COALESCE(SUM(PrecioActual), 0) FROM Subastas WHERE ProveedorID = ? AND Estado = 'Activa' AND FechaFin > NOW()) AS valorMisSubastas,
                    (SELECT COUNT(*) FROM MensajesChat WHERE DestinatarioID = ?) AS mensajesRecibidos,
                    (SELECT COUNT(*) FROM TratosCerrados WHERE ProveedorID = ? AND TipoOrigen = 'Subasta' AND EstadoTrato <> 'Cancelado') AS subastasVendidas,
                    (SELECT COALESCE(SUM(MontoTotal), 0) FROM TratosCerrados WHERE ProveedorID = ? AND TipoOrigen = 'Subasta' AND EstadoTrato <> 'Cancelado') AS montoVendido
            `, p7);
            Object.assign(mia, m);
        } else if (usuario.rol === 'emprendedor') {
            const [m] = await consulta(`
                SELECT
                    (SELECT COUNT(*) FROM Pujas WHERE EmprendedorID = ?) AS misPujas,
                    (SELECT COUNT(DISTINCT SubastaID) FROM Pujas WHERE EmprendedorID = ?) AS subastasParticipando,
                    (SELECT COUNT(*) FROM Subastas s
                       WHERE s.Estado = 'Activa' AND s.FechaFin > NOW()
                         AND s.PrecioActual = (SELECT MAX(MontoPuja) FROM Pujas WHERE SubastaID = s.SubastaID AND EmprendedorID = ?)) AS subastasLiderando,
                    (SELECT COALESCE(SUM(s.PrecioActual), 0) FROM Subastas s
                       WHERE s.Estado = 'Activa' AND s.FechaFin > NOW()
                         AND s.PrecioActual = (SELECT MAX(MontoPuja) FROM Pujas WHERE SubastaID = s.SubastaID AND EmprendedorID = ?)) AS montoLiderando,
                    (SELECT COUNT(*) FROM MensajesChat WHERE DestinatarioID = ?) AS mensajesRecibidos,
                    (SELECT COUNT(*) FROM TratosCerrados WHERE EmprendedorID = ? AND TipoOrigen = 'Subasta' AND EstadoTrato <> 'Cancelado') AS subastasGanadas,
                    (SELECT COALESCE(SUM(MontoTotal), 0) FROM TratosCerrados WHERE EmprendedorID = ? AND TipoOrigen = 'Subasta' AND EstadoTrato <> 'Cancelado') AS montoGanado
            `, p7);
            Object.assign(mia, m);
        }
        // Calificación que me dieron en mis tratos completados
        if (usuario.rol === 'proveedor' || usuario.rol === 'emprendedor') {
            const [cal] = await consulta('SELECT COUNT(*) AS total, AVG(Puntuacion) AS promedio FROM Calificaciones WHERE CalificadoID = ?', [yo]);
            mia.misCalificaciones = Number(cal.total);
            mia.miCalificacion = redondearCalificacion(cal.promedio);
        }
        return mia;
    }

    router.get('/', verificarToken, async (req, res) => {
        const meses = PERIODOS.includes(Number(req.query.meses)) ? Number(req.query.meses) : 6;
        const inicio = inicioDelPeriodo(meses);
        const yo = req.usuario.id;

        const [[resumen], categorias, departamentos, filasActividad, subastas, pujasRecientes, miActividad] = await Promise.all([
            consulta(`
                SELECT
                    (SELECT COUNT(*) FROM Usuarios WHERE LOWER(TipoRol) = 'proveedor') AS proveedores,
                    (SELECT COUNT(*) FROM Usuarios WHERE LOWER(TipoRol) = 'emprendedor') AS emprendedores,
                    (SELECT COUNT(*) FROM Usuarios WHERE FechaRegistro >= NOW() - INTERVAL 30 DAY) AS nuevosUsuarios30d,
                    (SELECT COUNT(*) FROM Ofertas) AS ofertas,
                    (SELECT COUNT(*) FROM Ofertas WHERE FechaPublicacion >= NOW() - INTERVAL 30 DAY) AS ofertas30d,
                    (SELECT COALESCE(AVG(Precio), 0) FROM Ofertas) AS precioPromedio,
                    (SELECT COUNT(*) FROM Subastas WHERE Estado = 'Activa' AND FechaFin > NOW()) AS subastasActivas,
                    (SELECT COUNT(*) FROM Subastas WHERE Estado = 'Finalizada' OR (Estado = 'Activa' AND FechaFin <= NOW())) AS subastasCerradas,
                    (SELECT COALESCE(SUM(PrecioActual), 0) FROM Subastas WHERE Estado = 'Activa' AND FechaFin > NOW()) AS valorEnSubasta,
                    (SELECT COUNT(*) FROM Pujas) AS pujas,
                    (SELECT COUNT(*) FROM Pujas WHERE FechaPuja >= NOW() - INTERVAL 30 DAY) AS pujas30d,
                    (SELECT COUNT(*) FROM MensajesChat) AS mensajes,
                    (SELECT COUNT(*) FROM MensajesChat WHERE FechaEnvio >= NOW() - INTERVAL 30 DAY) AS mensajes30d
            `),
            consulta(`
                SELECT c.NombreCategoria AS categoria,
                       COUNT(o.OfertaID) AS ofertas,
                       COALESCE(AVG(o.Precio), 0) AS precioPromedio,
                       COALESCE(MIN(o.Precio), 0) AS precioMinimo,
                       COALESCE(MAX(o.Precio), 0) AS precioMaximo
                FROM CategoriasMateriales c
                JOIN Ofertas o ON o.CategoriaID = c.CategoriaID
                GROUP BY c.CategoriaID, c.NombreCategoria
                ORDER BY ofertas DESC, categoria
            `),
            consulta(`
                SELECT d.NombreDepartamento AS departamento,
                       SUM(LOWER(u.TipoRol) = 'proveedor') AS proveedores,
                       SUM(LOWER(u.TipoRol) = 'emprendedor') AS emprendedores
                FROM PerfilesUsuarios p
                JOIN Usuarios u ON u.UsuarioID = p.UsuarioID
                JOIN Departamentos d ON d.DepartamentoID = p.DepartamentoID
                WHERE LOWER(u.TipoRol) IN ('proveedor', 'emprendedor')
                GROUP BY d.DepartamentoID, d.NombreDepartamento
                ORDER BY (proveedores + emprendedores) DESC, departamento
            `),
            consulta(`
                SELECT 'registros' AS tipo, DATE_FORMAT(FechaRegistro, '%Y-%m') AS mes, COUNT(*) AS total
                  FROM Usuarios WHERE FechaRegistro >= ? GROUP BY mes
                UNION ALL
                SELECT 'ofertas', DATE_FORMAT(FechaPublicacion, '%Y-%m'), COUNT(*)
                  FROM Ofertas WHERE FechaPublicacion >= ? GROUP BY 2
                UNION ALL
                SELECT 'pujas', DATE_FORMAT(FechaPuja, '%Y-%m'), COUNT(*)
                  FROM Pujas WHERE FechaPuja >= ? GROUP BY 2
            `, [inicio, inicio, inicio]),
            consulta(`
                SELECT s.SubastaID AS id, s.TituloLote AS lote,
                       COALESCE(pr.NombreRazonSocial, 'Proveedor') AS proveedor,
                       s.PrecioBase AS precioBase, s.PrecioActual AS precioActual,
                       s.FechaFin AS fechaFin, COUNT(pj.PujaID) AS pujas,
                       (s.ProveedorID = ?) AS esMia
                FROM Subastas s
                LEFT JOIN Pujas pj ON pj.SubastaID = s.SubastaID
                LEFT JOIN PerfilesUsuarios pr ON pr.UsuarioID = s.ProveedorID
                WHERE s.Estado = 'Activa' AND s.FechaFin > NOW()
                GROUP BY s.SubastaID
                ORDER BY pujas DESC, s.FechaFin ASC
                LIMIT 100
            `, [yo]),
            // Los nombres de los postores solo los ve el administrador
            consulta(`
                SELECT pj.MontoPuja AS monto, pj.FechaPuja AS fecha, s.TituloLote AS lote,
                       ${req.usuario.esAdmin ? "COALESCE(pe.NombreRazonSocial, 'Emprendedor')" : 'NULL'} AS postor,
                       (pj.EmprendedorID = ?) AS esMia
                FROM Pujas pj
                JOIN Subastas s ON s.SubastaID = pj.SubastaID
                LEFT JOIN PerfilesUsuarios pe ON pe.UsuarioID = pj.EmprendedorID
                ORDER BY pj.FechaPuja DESC, pj.PujaID DESC
                LIMIT 15
            `, [yo]),
            actividadPropia(req.usuario)
        ]);

        res.json({
            generado: new Date().toISOString(),
            periodoMeses: meses,
            esAdmin: req.usuario.esAdmin,
            resumen: aNumeros(resumen),
            categorias: categorias.map(aNumeros),
            departamentos: departamentos.map(aNumeros),
            actividad: serieMensual(filasActividad, inicio, meses),
            subastas: subastas.map(s => ({ ...aNumeros(s), esMia: !!s.esMia })),
            pujasRecientes: pujasRecientes.map(p => ({ ...aNumeros(p), esMia: !!p.esMia })),
            miActividad: aNumeros(miActividad)
        });
    });

    return router;
}

module.exports = crearRutasDashboard;

// Usadas también por rutas/reportes.js
module.exports.inicioDelPeriodo = inicioDelPeriodo;
module.exports.PERIODOS = PERIODOS;
