// 21. Calificaciones de los tratos
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('21. Calificaciones de los tratos');
    const calificar = (sesion, id, body) => api('POST', `/api/tratos/${id}/calificacion`, { token: sesion && sesion.token, body });
    r = await calificar(null, ctx.tratoId, { puntuacion: 5 });
    check('Calificar sin sesión → 401', r.status === 401);
    r = await calificar(ctx.perdedor, ctx.tratoId, { puntuacion: 5 });
    check('Alguien que no es parte del trato → 404', r.status === 404);
    for (const mala of [0, 6, 4.5, 'cinco', null]) {
        r = await calificar(ctx.ganador, ctx.tratoId, { puntuacion: mala });
        check(`Puntuación ${JSON.stringify(mala)} → 400`, r.status === 400, JSON.stringify(r));
    }
    r = await calificar(ctx.ganador, ctx.tratoCancelar, { puntuacion: 3 });
    check('Un trato cancelado no se califica → 409', r.status === 409 && /completado/.test(r.data.message), JSON.stringify(r));
    r = await calificar(ctx.ganador, ctx.tratoId, { puntuacion: 4, comentario: '  Buen cuero, entrega puntual ' + 'x'.repeat(400) });
    check('El comprador califica al proveedor con 4 estrellas', r.status === 201 && r.data.calificadoId === ctx.p1.id, JSON.stringify(r));
    const filaCal = (await q(`SELECT puntuacion, comentario FROM calificaciones WHERE trato_id = $1 AND autor_id = $2`, [ctx.tratoId, ctx.ganador.id]))[0];
    check('…el comentario se guarda recortado a 300 letras', filaCal.Puntuacion === 4 && filaCal.Comentario.startsWith('Buen cuero') && filaCal.Comentario.length === 300, JSON.stringify(filaCal).slice(0, 120));
    check('…y el proveedor recibe un aviso en el chat', /4 de 5 estrellas/.test(await ctx.ultimoMensaje(ctx.ganador.id, ctx.p1.id)));
    r = await calificar(ctx.ganador, ctx.tratoId, { puntuacion: 1 });
    check('Calificar dos veces el mismo trato → 409', r.status === 409 && /Ya calificaste/.test(r.data.message));
    r = await calificar(ctx.p1, ctx.tratoId, { puntuacion: 5 });
    check('El proveedor también califica al comprador', r.status === 201 && r.data.calificadoId === ctx.ganador.id, JSON.stringify(r));
    r = await api('GET', '/api/tratos', { token: ctx.ganador.token });
    const tratoCalificado = r.data.find(t => t.id === ctx.tratoId);
    check('/api/tratos muestra mi calificación y la que me dieron', tratoCalificado.miCalificacion === 4 && tratoCalificado.suCalificacion === 5, JSON.stringify(tratoCalificado));
    r = await api('GET', `/api/usuarios/${ctx.p1.id}/reputacion`, { token: ctx.e1.token });
    check('Reputación del proveedor: promedio 4 de 1 calificación, con el comentario', r.status === 200 && r.data.promedio === 4 && r.data.total === 1 && r.data.ultimas[0].comentario.startsWith('Buen cuero'), JSON.stringify(r.data).slice(0, 200));
    r = await api('GET', `/api/usuarios/${ctx.p1.id}/reputacion`);
    check('…ver la reputación pide sesión (401)', r.status === 401);
    r = await api('GET', `/api/ofertas?proveedorId=${ctx.p1.id}`);
    check('Las ofertas del proveedor muestran su calificación en el Mercado', r.data.length >= 1 && r.data.every(o => o.CalificacionProveedor === 4 && o.TotalCalificaciones === 1), JSON.stringify(r.data.map(o => [o.CalificacionProveedor, o.TotalCalificaciones])));
    r = await api('GET', '/api/dashboard', { token: ctx.p1.token });
    check('El dashboard muestra "Mi calificación"', r.data.miActividad.miCalificacion === 4 && r.data.miActividad.misCalificaciones === 1, JSON.stringify(r.data.miActividad));
}
