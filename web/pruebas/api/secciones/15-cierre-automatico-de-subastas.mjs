// 14. Cierre automático de subastas
// En Vercel el cierre es perezoso (al listar subastas, pujar, ver tratos o el dashboard) y con un
// cron diario. Aquí CIERRE_PEREZOSO=0: lo dispara /api/admin/subastas/cerrar-vencidas.
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { B, api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('14. Cierre automático de subastas');
    // subP1 venció en la sección 5 con pujas; el lote "Suela de hule (lote)" (proveedor 2, sección 16) se vence sin pujas
    const subP2 = (await q(`SELECT subasta_id FROM subastas WHERE proveedor_id = $1 AND titulo_lote = 'Lote Subasta: Suela de hule (lote)'`, [ctx.p2.id]))[0];
    await q(`UPDATE subastas SET fecha_fin = NOW() - interval '1 minute' WHERE subasta_id = $1`, [subP2.SubastaID]);
    const listadas = (await api('GET', '/api/subastas')).data;
    check('Las subastas vencidas ya no aparecen en /api/subastas', !listadas.some(s => s.SubastaID === ctx.subP1.SubastaID || s.SubastaID === subP2.SubastaID));
    const mejor = (await q(`SELECT emprendedor_id, monto_puja FROM pujas WHERE subasta_id = $1 ORDER BY monto_puja DESC LIMIT 1`, [ctx.subP1.SubastaID]))[0];
    ctx.ganador = mejor.EmprendedorID === ctx.e1.id ? ctx.e1 : ctx.e2;
    ctx.perdedor = ctx.ganador === ctx.e1 ? ctx.e2 : ctx.e1;

    r = await api('POST', '/api/admin/subastas/cerrar-vencidas', { token: ctx.p1.token });
    check('Proveedor intenta forzar el cierre → 403', r.status === 403);
    r = await api('POST', '/api/admin/subastas/cerrar-vencidas', { token: ctx.admin.token });
    const cierreP1 = r.data && r.data.cerradas.find(c => c.subastaId === ctx.subP1.SubastaID);
    const cierreP2 = r.data && r.data.cerradas.find(c => c.subastaId === subP2.SubastaID);
    check('Admin cierra las vencidas: gana la puja más alta (590)', r.status === 200 && cierreP1 && cierreP1.ganadorId === ctx.ganador.id && cierreP1.monto === 590, JSON.stringify(r.data));
    check('…la subasta sin pujas se cierra sin ganador', cierreP2 && cierreP2.ganadorId === null);
    const estados = await q(`SELECT subasta_id, estado FROM subastas WHERE subasta_id IN ($1, $2)`, [ctx.subP1.SubastaID, subP2.SubastaID]);
    check('…ambas quedan "Finalizada"', estados.length === 2 && estados.every(s => s.Estado === 'Finalizada'));
    ctx.tratos = await q(`SELECT * FROM tratos_cerrados WHERE tipo_origen = 'Subasta' AND origen_id = $1`, [ctx.subP1.SubastaID]);
    check('…se registra el trato (proveedor, ganador, C$590, Pendiente)', ctx.tratos.length === 1 && ctx.tratos[0].ProveedorID === ctx.p1.id && ctx.tratos[0].EmprendedorID === ctx.ganador.id && Number(ctx.tratos[0].MontoTotal) === 590 && ctx.tratos[0].EstadoTrato === 'Pendiente', JSON.stringify(ctx.tratos));
    const aviso = (await q(`SELECT contenido_texto FROM mensajes_chat WHERE remitente_id = $1 AND destinatario_id = $2 ORDER BY mensaje_id DESC LIMIT 1`, [ctx.p1.id, ctx.ganador.id]))[0];
    check('…y se abre el chat con un mensaje automático al ganador', aviso && /Ganaste la subasta/.test(aviso.ContenidoTexto), JSON.stringify(aviso));
    r = await api('POST', '/api/admin/subastas/cerrar-vencidas', { token: ctx.admin.token });
    const tratosOtraVez = (await q(`SELECT count(*)::int n FROM tratos_cerrados WHERE origen_id = $1 AND tipo_origen = 'Subasta'`, [ctx.subP1.SubastaID]))[0].n;
    check('Volver a ejecutar el cierre no duplica nada', r.status === 200 && r.data.cerradas.length === 0 && tratosOtraVez === 1, JSON.stringify(r.data));
    r = await api('POST', '/api/pujas', { token: ctx.perdedor.token, body: { subastaId: ctx.subP1.SubastaID, montoPuja: 99999 } });
    check('Pujar en una subasta finalizada → 409', r.status === 409);

    r = await api('GET', '/api/tratos', { token: ctx.ganador.token });
    check('El ganador ve el trato en /api/tratos (contraparte: el proveedor)', r.status === 200 && r.data.length === 1 && !r.data[0].soyProveedor && r.data[0].contraparte === 'Curtiembre Uno' && r.data[0].monto === 590, JSON.stringify(r.data));
    r = await api('GET', '/api/tratos', { token: ctx.p1.token });
    check('El proveedor también lo ve, como vendedor', r.status === 200 && r.data.length === 1 && r.data[0].soyProveedor);
    r = await api('GET', '/api/tratos', { token: ctx.perdedor.token });
    check('Quien perdió no ve tratos ajenos', r.status === 200 && r.data.length === 0);
    r = await api('GET', '/api/tratos');
    check('/api/tratos sin sesión → 401', r.status === 401);
    r = await api('GET', '/api/dashboard', { token: ctx.ganador.token });
    check('Dashboard del ganador: 1 subasta ganada por C$590', r.status === 200 && r.data.miActividad.subastasGanadas === 1 && r.data.miActividad.montoGanado === 590, JSON.stringify(r.data && r.data.miActividad));
    r = await api('GET', '/api/dashboard', { token: ctx.p1.token });
    check('Dashboard del proveedor: 1 subasta vendida', r.status === 200 && r.data.miActividad.subastasVendidas === 1, JSON.stringify(r.data && r.data.miActividad));

    // Cron diario de Vercel: solo responde con el secreto (CRON_SECRET)
    const cron = (auth) => fetch(B + '/api/cron/cerrar-subastas', { headers: auth ? { Authorization: auth } : {} }).then(async (x) => ({ status: x.status, data: await x.json() }));
    r = await cron();
    check('El cron de cierre sin secreto → 401', r.status === 401);
    r = await cron('Bearer secreto-equivocado');
    check('…con un secreto equivocado → 401', r.status === 401);
    r = await cron('Bearer secreto-cron-pruebas');
    check('…con el secreto corre el cierre (no quedaba nada por cerrar)', r.status === 200 && r.data.cerradas === 0, JSON.stringify(r));
}
