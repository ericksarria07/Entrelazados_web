// 25. Notificaciones (campana)
// Portada de backend/pruebas/pruebas_api.js. Los avisos en tiempo real llegan por Ably (ver la sección 23):
// sin ABLY_API_KEY esas comprobaciones se omiten (ctx.checkTR) y las de la base de datos corren igual.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r, n;
    seccion('25. Notificaciones (campana)');
    r = await api('GET', '/api/notificaciones');
    check('Sin sesión → 401', r.status === 401);
    r = await api('GET', '/api/notificaciones', { token: ctx.e1.token });
    check('Ver mis notificaciones: las más nuevas primero, con el total sin leer', r.status === 200 && r.data.noLeidas >= 1 && r.data.notificaciones[0].tipo === 'PujaSuperada' && r.data.notificaciones.length === r.data.noLeidas, JSON.stringify(r.data).slice(0, 300));
    const idNotifE1 = r.data.notificaciones[0].id;
    const noLeidasE1 = r.data.noLeidas;
    r = await api('PUT', `/api/notificaciones/${idNotifE1}/leida`, { token: ctx.e3.token });
    check('Marcar como leída la notificación de otra persona → 404', r.status === 404);
    r = await api('PUT', '/api/notificaciones/abc/leida', { token: ctx.e1.token });
    check('ID no válido → 404', r.status === 404);
    r = await api('PUT', `/api/notificaciones/${idNotifE1}/leida`, { token: ctx.e1.token });
    const notifsDespues = (await api("GET", "/api/notificaciones", { token: ctx.e1.token })).data;
    check('Marcar una como leída', r.status === 200 && notifsDespues.noLeidas === noLeidasE1 - 1 && notifsDespues.notificaciones.find(x => x.id === idNotifE1).leida === true, JSON.stringify(notifsDespues).slice(0, 200));
    r = await api('PUT', '/api/notificaciones/leidas', { token: ctx.p2.token });
    check('Marcar todas como leídas', r.status === 200 && r.data.marcadas >= 1 && (await api('GET', '/api/notificaciones', { token: ctx.p2.token })).data.noLeidas === 0, JSON.stringify(r.data));

    await q(`UPDATE subastas SET fecha_fin = NOW() - interval '1 minute' WHERE subasta_id = $1`, [ctx.subRT]);
    const ganada = ctx.esperarEvento(ctx.sE3, 'notificacion:nueva', x => x.tipo === 'SubastaGanada');
    const chatGanador = ctx.esperarEvento(ctx.sE3, 'chat:mensaje', d => d.remitenteId === ctx.p2.id);
    const cambioLista = ctx.esperarEvento(ctx.anonimo.socket, 'subastas:cambio', d => d.motivo === 'cerrada');
    r = await api('POST', '/api/admin/subastas/cerrar-vencidas', { token: ctx.admin.token });
    n = await ganada;
    check('Cerrar las subastas vencidas responde 200', r.status === 200, JSON.stringify(r));
    ctx.checkTR('Al cerrar la subasta, el ganador recibe "¡Ganaste!"', n && /C\$350/.test(n.mensaje) && n.enlace === '/chat', JSON.stringify(n));
    ctx.checkTR('…y el mensaje automático del chat le llega al instante', (await chatGanador) !== null);
    ctx.checkTR('…y todas las páginas saben que la lista de subastas cambió', (await cambioLista) !== null);
    const cierreNotifs = await q(`SELECT usuario_id, tipo FROM notificaciones WHERE referencia_id = $1 AND tipo IN ('SubastaTerminada', 'SubastaGanada') ORDER BY usuario_id`, [ctx.subRT]);
    check('…el proveedor y quien perdió reciben "Terminó la subasta"', cierreNotifs.length === 3 && cierreNotifs.some(x => x.UsuarioID === ctx.p2.id && x.Tipo === 'SubastaTerminada') && cierreNotifs.some(x => x.UsuarioID === ctx.e1.id && x.Tipo === 'SubastaTerminada'), JSON.stringify(cierreNotifs));

    const tratoRT = (await q(`SELECT trato_id FROM tratos_cerrados WHERE origen_id = $1 AND tipo_origen = 'Subasta'`, [ctx.subRT]))[0].TratoID;
    const notifTrato = ctx.esperarEvento(ctx.sE3, 'notificacion:nueva', x => x.tipo === 'TratoActualizado');
    r = await api('PUT', `/api/tratos/${tratoRT}/estado`, { token: ctx.p2.token, body: { estado: 'Completado' } });
    n = await notifTrato;
    check('Cambiar el estado de un trato responde 200', r.status === 200, JSON.stringify(r));
    ctx.checkTR('Cambiar el estado de un trato notifica a la otra parte', n && /completado/.test(n.titulo), JSON.stringify(n));
    const notifCalif = ctx.esperarEvento(ctx.sP2, 'notificacion:nueva', x => x.tipo === 'CalificacionRecibida');
    r = await api('POST', `/api/tratos/${tratoRT}/calificacion`, { token: ctx.e3.token, body: { puntuacion: 4, comentario: 'Buen hilo' } });
    n = await notifCalif;
    check('Calificar responde 201', r.status === 201, JSON.stringify(r));
    ctx.checkTR('Calificar notifica a quien recibe la calificación', n && /★★★★☆/.test(n.titulo) && /Buen hilo/.test(n.mensaje), JSON.stringify([r.data, n]));
    check('…la respuesta de calificar no cambió de forma', r.data && r.data.calificadoId === ctx.p2.id && r.data.lote === undefined, JSON.stringify(r.data));

    const desconexion = new Promise((listo) => { ctx.sE3.once('disconnect', () => listo(true)); setTimeout(() => listo(false), ctx.sE3.connected ? 8000 : 0); });
    r = await api('PUT', `/api/admin/usuarios/${ctx.e3.id}/estado`, { token: ctx.admin.token, body: { nuevoEstado: 'Suspendido' } });
    check('Suspender una cuenta responde 200', r.status === 200, JSON.stringify(r));
    ctx.checkTR('Suspender una cuenta corta al instante su conexión en tiempo real (Ably revoca sus permisos)', await desconexion);
    const suspendido = await ctx.conectarSocket(ctx.e3.token);
    ctx.checkTR('…y ya no se puede volver a conectar', !suspendido.ok && suspendido.error === 'sesion-invalida', suspendido.error);
    suspendido.socket.close();
    await api('PUT', `/api/admin/usuarios/${ctx.e3.id}/estado`, { token: ctx.admin.token, body: { nuevoEstado: 'Activo' } });
    for (const s of [ctx.anonimo.socket, ctx.sP2, ctx.sE1, ctx.sE3]) s.close();
}
