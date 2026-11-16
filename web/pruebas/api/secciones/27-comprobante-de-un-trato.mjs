// 28. Comprobante de un trato
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q, B } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('28. Comprobante de un trato');
    const tratoComprobante = (await q(`SELECT trato_id FROM tratos_cerrados WHERE tipo_origen = 'Subasta' AND origen_id = $1`, [ctx.subRT]))[0].TratoID;
    r = await api('GET', `/api/tratos/${tratoComprobante}/comprobante`);
    check('Sin sesión → 401', r.status === 401);
    r = await api('GET', `/api/tratos/${tratoComprobante}/comprobante`, { token: ctx.e3.token });
    const comp = r.data;
    check('El comprador ve el comprobante con su folio', r.status === 200 && comp.folio === `EL-${String(tratoComprobante).padStart(6, '0')}` && comp.monto === 350 && comp.moneda === 'NIO', JSON.stringify(comp));
    check('…con las dos partes y sus datos de contacto', comp.proveedor.nombre === 'Curtiembre Dos' && comp.proveedor.correo === 'prov2@prueba.com' && comp.comprador.nombre === 'Zapatería Tres' && comp.comprador.departamento === 'Managua', JSON.stringify([comp.proveedor, comp.comprador]));
    check('…y los datos de la subasta (lote, precio base, 5 pujas)', comp.subasta && comp.subasta.lote === 'Hilo encerado tiempo real' && comp.subasta.precioBase === 100 && comp.subasta.pujas === 5 && comp.concepto === 'Hilo encerado tiempo real', JSON.stringify(comp.subasta));
    r = await api('GET', `/api/tratos/${tratoComprobante}/comprobante`, { token: ctx.p2.token });
    check('El proveedor también lo ve', r.status === 200 && r.data.folio === comp.folio);
    r = await api('GET', `/api/tratos/${tratoComprobante}/comprobante`, { token: ctx.admin.token });
    check('El administrador también', r.status === 200);
    r = await api('GET', `/api/tratos/${tratoComprobante}/comprobante`, { token: ctx.e1.token });
    check('Alguien que no es parte del trato → 404', r.status === 404);
    r = await api('GET', '/api/tratos/abc/comprobante', { token: ctx.e3.token });
    check('Número de trato inválido → 404', r.status === 404);
    r = await fetch(B + '/comprobante.html');
    check('La página comprobante.html existe', r.status === 200 && /Comprobante de trato/.test(await r.text()));
}
