// ==========================================================================
// REPORTES: GET /api/reportes?meses=3|6|12   (pide sesión; lo usa reportes.html)
//
// Lo que cada quien ve:
//   administrador  → toda la plataforma
//   proveedor      → sus ventas (sus subastas y sus tratos)
//   emprendedor    → sus compras (las subastas donde pujó y sus tratos)
// Los precios por categoría son del mercado completo (son públicos).
//
// Responde en una sola llamada (las consultas van en paralelo):
//   resumen               totales de tratos, montos y resultado de las subastas
//   ventasPorMes          serie mensual: tratos, monto completado y cancelados
//   estadoSubastas        cuántas con ganador, sin pujas, canceladas y en curso
//   materialesMasPedidos  categorías con más pujas (y su monto en tratos)
//   lotesMasDisputados    las 10 subastas con más pujas
//   preciosPorCategoria   precio base promedio de los lotes, por mes, de las 5 categorías con más lotes
//   tratos                detalle de los tratos del periodo (máx. 200)
// ==========================================================================
const express = require('express');
const { inicioDelPeriodo, PERIODOS } = require('./dashboard');

const ESTADO_SUBASTA = `
    CASE WHEN s.Estado = 'Cancelada' THEN 'Canceladas'
         WHEN s.Estado = 'Activa' AND s.FechaFin > NOW() THEN 'En curso'
         WHEN (SELECT COUNT(*) FROM Pujas px WHERE px.SubastaID = s.SubastaID) > 0 THEN 'Con ganador'
         ELSE 'Sin pujas' END`;

const num = (v) => Number(v) || 0;
const redondear = (v, decimales = 2) => Math.round(num(v) * 10 ** decimales) / 10 ** decimales;

// Claves "AAAA-MM" de todos los meses del periodo (también los que no tuvieron actividad)
function mesesDelPeriodo(inicio, meses) {
    return Array.from({ length: meses }, (_, i) => {
        const f = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
        return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
    });
}

// Filtros SQL según el rol de quien pide el reporte
function alcanceDe(usuario) {
    const yo = usuario.id;
    if (usuario.esAdmin) {
        return { nombre: 'plataforma', tratos: ['1 = 1', []], subastas: ['1 = 1', []], pujas: ['1 = 1', []] };
    }
    if (usuario.rol === 'proveedor') {
        return {
            nombre: 'ventas',
            tratos: ['t.ProveedorID = ?', [yo]],
            subastas: ['s.ProveedorID = ?', [yo]],
            pujas: ['s.ProveedorID = ?', [yo]]
        };
    }
    return {
        nombre: 'compras',
        tratos: ['t.EmprendedorID = ?', [yo]],
        subastas: ['s.SubastaID IN (SELECT SubastaID FROM Pujas WHERE EmprendedorID = ?)', [yo]],
        pujas: ['p.EmprendedorID = ?', [yo]]
    };
}

function crearRutasReportes({ db, verificarToken }) {
    const router = express.Router();
    const consulta = async (sql, params = []) => (await db.query(sql, params))[0];

    router.get('/', verificarToken, async (req, res) => {
        const meses = PERIODOS.includes(Number(req.query.meses)) ? Number(req.query.meses) : 6;
        const inicio = inicioDelPeriodo(meses);
        const claves = mesesDelPeriodo(inicio, meses);
        const alcance = alcanceDe(req.usuario);
        const [filtroTratos, pTratos] = alcance.tratos;
        const [filtroSubastas, pSubastas] = alcance.subastas;
        const [filtroPujas, pPujas] = alcance.pujas;

        const [tratosMes, estados, categorias, lotes, topCategorias, tratos] = await Promise.all([
            consulta(`
                SELECT DATE_FORMAT(t.FechaCierre, '%Y-%m') AS mes,
                       COUNT(*) AS tratos,
                       SUM(t.EstadoTrato = 'Completado') AS completados,
                       SUM(t.EstadoTrato = 'Cancelado') AS cancelados,
                       COALESCE(SUM(IF(t.EstadoTrato = 'Completado', t.MontoTotal, 0)), 0) AS montoCompletado,
                       COALESCE(SUM(IF(t.EstadoTrato <> 'Cancelado', t.MontoTotal, 0)), 0) AS monto
                FROM TratosCerrados t
                WHERE ${filtroTratos} AND t.FechaCierre >= ?
                GROUP BY mes`, [...pTratos, inicio]),
            consulta(`
                SELECT x.estado, COUNT(*) AS total
                FROM (SELECT ${ESTADO_SUBASTA} AS estado
                      FROM Subastas s
                      WHERE ${filtroSubastas} AND s.FechaInicio >= ?) x
                GROUP BY x.estado`, [...pSubastas, inicio]),
            consulta(`
                SELECT COALESCE(c.NombreCategoria, 'Sin categoría') AS categoria,
                       COUNT(p.PujaID) AS pujas,
                       COUNT(DISTINCT p.SubastaID) AS subastas,
                       COALESCE(MAX(p.MontoPuja), 0) AS pujaMaxima
                FROM Pujas p
                JOIN Subastas s ON s.SubastaID = p.SubastaID
                LEFT JOIN CategoriasMateriales c ON c.CategoriaID = s.CategoriaID
                WHERE ${filtroPujas} AND p.FechaPuja >= ?
                GROUP BY s.CategoriaID, c.NombreCategoria
                ORDER BY pujas DESC, categoria
                LIMIT 10`, [...pPujas, inicio]),
            consulta(`
                SELECT s.SubastaID AS id, s.TituloLote AS lote,
                       COALESCE(c.NombreCategoria, 'Sin categoría') AS categoria,
                       s.PrecioBase AS precioBase, s.PrecioActual AS precioFinal,
                       ${ESTADO_SUBASTA} AS estado,
                       (SELECT COUNT(*) FROM Pujas p WHERE p.SubastaID = s.SubastaID) AS pujas
                FROM Subastas s
                LEFT JOIN CategoriasMateriales c ON c.CategoriaID = s.CategoriaID
                WHERE ${filtroSubastas} AND s.FechaInicio >= ?
                HAVING pujas > 0
                ORDER BY pujas DESC, precioFinal DESC
                LIMIT 10`, [...pSubastas, inicio]),
            // Mercado completo: las 5 categorías con más lotes en el periodo
            consulta(`
                SELECT s.CategoriaID AS id, c.NombreCategoria AS categoria, COUNT(*) AS lotes
                FROM Subastas s JOIN CategoriasMateriales c ON c.CategoriaID = s.CategoriaID
                WHERE s.FechaInicio >= ?
                GROUP BY s.CategoriaID, c.NombreCategoria
                ORDER BY lotes DESC, categoria
                LIMIT 5`, [inicio]),
            consulta(`
                SELECT t.TratoID AS id, t.FechaCierre AS fecha, t.DescripcionResumen AS descripcion,
                       t.MontoTotal AS monto, t.EstadoTrato AS estado,
                       COALESCE(pp.NombreRazonSocial, 'Proveedor') AS proveedor,
                       COALESCE(pe.NombreRazonSocial, 'Emprendedor') AS comprador
                FROM TratosCerrados t
                LEFT JOIN PerfilesUsuarios pp ON pp.UsuarioID = t.ProveedorID
                LEFT JOIN PerfilesUsuarios pe ON pe.UsuarioID = t.EmprendedorID
                WHERE ${filtroTratos} AND t.FechaCierre >= ?
                ORDER BY t.FechaCierre DESC, t.TratoID DESC
                LIMIT 200`, [...pTratos, inicio])
        ]);

        // Precio base promedio por mes de las categorías principales
        const idsTop = topCategorias.map(c => c.id);
        const precios = idsTop.length === 0 ? [] : await consulta(`
            SELECT s.CategoriaID AS id, DATE_FORMAT(s.FechaInicio, '%Y-%m') AS mes, AVG(s.PrecioBase) AS promedio
            FROM Subastas s
            WHERE s.FechaInicio >= ? AND s.CategoriaID IN (?)
            GROUP BY s.CategoriaID, mes`, [inicio, idsTop]);

        // ---- Armar la respuesta
        const ventasPorMes = claves.map(mes => {
            const f = tratosMes.find(x => x.mes === mes) || {};
            return {
                mes,
                tratos: num(f.tratos),
                completados: num(f.completados),
                cancelados: num(f.cancelados),
                monto: redondear(f.monto),
                montoCompletado: redondear(f.montoCompletado)
            };
        });

        const estadoSubastas = ['Con ganador', 'Sin pujas', 'Canceladas', 'En curso']
            .map(estado => ({ estado, total: num((estados.find(e => e.estado === estado) || {}).total) }));
        const porEstado = Object.fromEntries(estadoSubastas.map(e => [e.estado, e.total]));
        const terminadas = porEstado['Con ganador'] + porEstado['Sin pujas'];

        const totalTratos = ventasPorMes.reduce((t, m) => t + m.tratos, 0);
        const cancelados = ventasPorMes.reduce((t, m) => t + m.cancelados, 0);
        const completados = ventasPorMes.reduce((t, m) => t + m.completados, 0);
        const monto = redondear(ventasPorMes.reduce((t, m) => t + m.monto, 0));
        const vigentes = totalTratos - cancelados;

        res.json({
            generado: new Date().toISOString(),
            periodoMeses: meses,
            desde: inicio.toISOString(),
            alcance: alcance.nombre,
            resumen: {
                tratos: totalTratos,
                completados,
                enCurso: vigentes - completados,
                cancelados,
                monto,
                montoCompletado: redondear(ventasPorMes.reduce((t, m) => t + m.montoCompletado, 0)),
                ticketPromedio: vigentes ? redondear(monto / vigentes) : 0,
                subastas: estadoSubastas.reduce((t, e) => t + e.total, 0),
                tasaExito: terminadas ? redondear(porEstado['Con ganador'] / terminadas, 4) : null
            },
            ventasPorMes,
            estadoSubastas,
            materialesMasPedidos: categorias.map(c => ({
                categoria: c.categoria, pujas: num(c.pujas), subastas: num(c.subastas), pujaMaxima: redondear(c.pujaMaxima)
            })),
            lotesMasDisputados: lotes.map(l => ({
                id: l.id,
                lote: String(l.lote || '').replace(/^Lote Subasta:\s*/i, ''),
                categoria: l.categoria,
                pujas: num(l.pujas),
                precioBase: redondear(l.precioBase),
                precioFinal: redondear(l.precioFinal),
                incremento: num(l.precioBase) > 0 ? redondear((l.precioFinal - l.precioBase) / l.precioBase, 4) : 0,
                estado: l.estado
            })),
            preciosPorCategoria: {
                meses: claves,
                series: topCategorias.map(c => ({
                    categoria: c.categoria,
                    lotes: num(c.lotes),
                    valores: claves.map(mes => {
                        const f = precios.find(p => p.id === c.id && p.mes === mes);
                        return f ? redondear(f.promedio) : null;
                    })
                }))
            },
            tratos: tratos.map(t => ({
                id: t.id,
                fecha: t.fecha,
                lote: String(t.descripcion || '').replace(/^Subasta ganada:\s*/i, '').replace(/^Lote Subasta:\s*/i, ''),
                monto: redondear(t.monto),
                estado: t.estado,
                proveedor: t.proveedor,
                comprador: t.comprador
            }))
        });
    });

    return router;
}

module.exports = crearRutasReportes;
module.exports.mesesDelPeriodo = mesesDelPeriodo;
