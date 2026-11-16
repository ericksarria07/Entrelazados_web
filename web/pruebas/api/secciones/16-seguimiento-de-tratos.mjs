// 17. Seguimiento de tratos
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('17. Seguimiento de tratos');
    ctx.tratoId = ctx.tratos[0].TratoID;
    const estadoTrato = async (id) => (await q(`SELECT estado_trato FROM tratos_cerrados WHERE trato_id = $1`, [id]))[0].EstadoTrato;
    ctx.ultimoMensaje = async (de, para) => ((await q(`SELECT contenido_texto FROM mensajes_chat WHERE remitente_id = $1 AND destinatario_id = $2 ORDER BY mensaje_id DESC LIMIT 1`, [de, para]))[0] || {}).ContenidoTexto || '';
    const cambiarTrato = (sesion, id, estado, extra = {}) => api('PUT', `/api/tratos/${id}/estado`, { token: sesion && sesion.token, body: { estado, ...extra } });

    r = await cambiarTrato(null, ctx.tratoId, 'EnProceso');
    check('Cambiar un trato sin sesión → 401', r.status === 401);
    r = await cambiarTrato(ctx.perdedor, ctx.tratoId, 'EnProceso');
    check('Alguien que no es parte del trato → 404 (no revela que existe)', r.status === 404, JSON.stringify(r));
    r = await cambiarTrato(ctx.admin, ctx.tratoId, 'Completado');
    check('El admin tampoco puede cambiar tratos ajenos → 404', r.status === 404);
    r = await cambiarTrato(ctx.ganador, ctx.tratoId, 'Pagado');
    check('Estado que no existe → 400', r.status === 400, JSON.stringify(r));
    r = await cambiarTrato(ctx.ganador, ctx.tratoId, 'Pendiente');
    check('Volver a "Pendiente" a mano → 400', r.status === 400);
    r = await cambiarTrato(ctx.ganador, 'abc', 'EnProceso');
    check('ID de trato inválido → 404', r.status === 404);
    check('…ninguno de esos intentos cambió el trato', await estadoTrato(ctx.tratoId) === 'Pendiente');

    r = await cambiarTrato(ctx.ganador, ctx.tratoId, 'EnProceso');
    check('El comprador marca el trato "En proceso"', r.status === 200 && r.data.estado === 'EnProceso' && r.data.estadoAnterior === 'Pendiente' && await estadoTrato(ctx.tratoId) === 'EnProceso', JSON.stringify(r));
    check('…y el proveedor recibe un aviso automático en el chat', /EN PROCESO/.test(await ctx.ultimoMensaje(ctx.ganador.id, ctx.p1.id)));
    r = await cambiarTrato(ctx.p1, ctx.tratoId, 'EnProceso');
    check('Marcarlo otra vez "En proceso" → 409', r.status === 409 && /ya está en proceso/.test(r.data.message), JSON.stringify(r));
    r = await api('GET', '/api/tratos', { token: ctx.p1.token });
    check('/api/tratos muestra el nuevo estado', r.data[0].estado === 'EnProceso');
    r = await cambiarTrato(ctx.p1, ctx.tratoId, 'Completado');
    check('El proveedor lo marca "Completado"', r.status === 200 && await estadoTrato(ctx.tratoId) === 'Completado', JSON.stringify(r));
    check('…y el comprador recibe el aviso', /COMPLETADO/.test(await ctx.ultimoMensaje(ctx.p1.id, ctx.ganador.id)));
    r = await cambiarTrato(ctx.ganador, ctx.tratoId, 'Cancelado');
    check('Un trato completado ya no se puede cancelar → 409', r.status === 409 && /completado/.test(r.data.message) && await estadoTrato(ctx.tratoId) === 'Completado', JSON.stringify(r));

    // Cancelar con motivo: deja de contar como subasta ganada / vendida
    const antes = (await api('GET', '/api/dashboard', { token: ctx.ganador.token })).data.miActividad;
    ctx.tratoCancelar = (await q(`INSERT INTO tratos_cerrados (proveedor_id, emprendedor_id, tipo_origen, origen_id, descripcion_resumen, monto_total, estado_trato, fecha_cierre)
        VALUES ($1, $2, 'Subasta', NULL, 'Subasta ganada: Lote Subasta: Hilo encerado', 100, 'Pendiente', NOW() - interval '2 day') RETURNING trato_id`, [ctx.p2.id, ctx.ganador.id])).insertId;
    const conNuevo = (await api('GET', '/api/dashboard', { token: ctx.ganador.token })).data.miActividad;
    check('Un trato nuevo suma a "subastas ganadas"', conNuevo.subastasGanadas === antes.subastasGanadas + 1 && conNuevo.montoGanado === antes.montoGanado + 100, JSON.stringify([antes, conNuevo]));
    r = await api('GET', '/api/tratos', { token: ctx.ganador.token });
    check('/api/tratos pone primero los abiertos aunque sean más antiguos', r.data[0].id === ctx.tratoCancelar && r.data[1].estado === 'Completado', JSON.stringify(r.data.map(t => [t.id, t.estado])));
    r = await cambiarTrato(ctx.ganador, ctx.tratoCancelar, 'Cancelado', { motivo: '  El material <b>no</b> era el de la foto  ' + 'x'.repeat(300) });
    check('El comprador cancela un trato pendiente con motivo', r.status === 200 && await estadoTrato(ctx.tratoCancelar) === 'Cancelado', JSON.stringify(r));
    const avisoCancelado = await ctx.ultimoMensaje(ctx.ganador.id, ctx.p2.id);
    check('…el aviso del chat lleva el motivo (recortado a 200 letras)', /Cancelé el trato «Hilo encerado»\. Motivo: El material <b>no<\/b> era el de la foto\s+x+$/.test(avisoCancelado) && avisoCancelado.split('Motivo: ')[1].length === 200, avisoCancelado);
    const despues = (await api('GET', '/api/dashboard', { token: ctx.ganador.token })).data.miActividad;
    check('…y deja de contar como subasta ganada en el dashboard', despues.subastasGanadas === antes.subastasGanadas && despues.montoGanado === antes.montoGanado, JSON.stringify(despues));

    // Las dos partes pulsan a la vez
    const tratoDoble = (await q(`INSERT INTO tratos_cerrados (proveedor_id, emprendedor_id, tipo_origen, descripcion_resumen, monto_total, estado_trato)
        VALUES ($1, $2, 'Subasta', 'Subasta ganada: Lote Subasta: Cuero doble', 50, 'Pendiente') RETURNING trato_id`, [ctx.p2.id, ctx.ganador.id])).insertId;
    const aLaVez = await Promise.all([cambiarTrato(ctx.p2, tratoDoble, 'Completado'), cambiarTrato(ctx.ganador, tratoDoble, 'Cancelado')]);
    const ganoQuien = aLaVez[0].status === 200 ? 'Completado' : 'Cancelado';
    check('Proveedor completa y comprador cancela a la vez: solo uno gana y el otro recibe 409', aLaVez.filter(x => x.status === 200).length === 1 && aLaVez.filter(x => x.status === 409).length === 1 && await estadoTrato(tratoDoble) === ganoQuien, JSON.stringify(aLaVez.map(x => x.status)));
}
