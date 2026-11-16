// 26. Reportes
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('26. Reportes');
    r = await api('GET', '/api/reportes');
    check('Sin sesión → 401', r.status === 401);
    r = await api('GET', '/api/reportes', { token: ctx.p2.token });
    const repP2 = r.data;
    check('El proveedor ve sus ventas (6 meses por defecto)', r.status === 200 && repP2.alcance === 'ventas' && repP2.periodoMeses === 6 && repP2.ventasPorMes.length === 6, JSON.stringify(r.data).slice(0, 300));
    check('…con el trato completado de C$350 en el mes actual', repP2.ventasPorMes[5].montoCompletado >= 350 && repP2.resumen.completados >= 1, JSON.stringify(repP2.ventasPorMes[5]));
    const loteRT = repP2.lotesMasDisputados.find(l => l.id === ctx.subRT);
    check('…y el lote más disputado con sus 5 pujas y el incremento (250%)', loteRT && loteRT.pujas === 5 && loteRT.precioFinal === 350 && loteRT.incremento === 2.5 && loteRT.estado === 'Con ganador', JSON.stringify(loteRT));
    check('…y los materiales más pedidos', repP2.materialesMasPedidos.some(m => /Hilos/.test(m.categoria) && m.pujas >= 5), JSON.stringify(repP2.materialesMasPedidos));
    check('…y el resultado de sus subastas', repP2.estadoSubastas.length === 4 && repP2.estadoSubastas.find(e => e.estado === 'Con ganador').total >= 1 && repP2.resumen.tasaExito > 0, JSON.stringify(repP2.estadoSubastas));
    check('…y los precios por categoría por mes', repP2.preciosPorCategoria.meses.length === 6 && repP2.preciosPorCategoria.series.length >= 1 && repP2.preciosPorCategoria.series.every(s => s.valores.length === 6), JSON.stringify(repP2.preciosPorCategoria).slice(0, 200));
    r = await api('GET', '/api/reportes', { token: ctx.e3.token });
    check('El emprendedor ve sus compras: solo sus tratos', r.status === 200 && r.data.alcance === 'compras' && r.data.tratos.length === 1 && r.data.tratos[0].monto === 350 && r.data.tratos[0].proveedor === 'Curtiembre Dos', JSON.stringify(r.data.tratos));
    r = await api('GET', '/api/reportes?meses=12', { token: ctx.admin.token });
    check('El administrador ve toda la plataforma, y se puede pedir 12 meses', r.status === 200 && r.data.alcance === 'plataforma' && r.data.ventasPorMes.length === 12 && r.data.resumen.tratos >= repP2.resumen.tratos, JSON.stringify(r.data.resumen));
    r = await api('GET', '/api/reportes?meses=7', { token: ctx.admin.token });
    check('Un periodo no permitido usa 6 meses', r.data.periodoMeses === 6);
}
