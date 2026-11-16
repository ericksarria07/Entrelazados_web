// 12. Eliminar usuarios (admin)
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q, B } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('12. Eliminar usuarios (admin)');
    r = await api('DELETE', `/api/admin/usuarios/${ctx.admin.id}`, { token: ctx.admin.token });
    check('Admin no puede eliminarse a sí mismo → 400', r.status === 400);
    r = await api('DELETE', `/api/admin/usuarios/${ctx.e2.id}`, { token: ctx.p1.token });
    check('Proveedor intenta eliminar usuario → 403', r.status === 403);
    r = await api('DELETE', `/api/admin/usuarios/${ctx.e2.id}`, { token: ctx.admin.token });
    check('Eliminar emprendedor con pujas y mensajes', r.status === 200, JSON.stringify(r));
    const restos = (await q(`SELECT (SELECT count(*)::int FROM pujas WHERE emprendedor_id=$1) p, (SELECT count(*)::int FROM mensajes_chat WHERE remitente_id=$2 OR destinatario_id=$3) m, (SELECT count(*)::int FROM perfiles_usuarios WHERE usuario_id=$4) pf`, [ctx.e2.id, ctx.e2.id, ctx.e2.id, ctx.e2.id]))[0];
    check('…sin dejar pujas, mensajes ni perfil huérfanos', restos.p === 0 && restos.m === 0 && restos.pf === 0, JSON.stringify(restos));
    r = await api('DELETE', `/api/admin/usuarios/${ctx.p1.id}`, { token: ctx.admin.token });
    check('Eliminar proveedor con subastas, pujas recibidas, calificaciones y mensajes', r.status === 200, JSON.stringify(r));
    const avisoBaja = (await q(`SELECT contenido_texto FROM mensajes_chat WHERE remitente_id = $1 AND destinatario_id = $2 ORDER BY mensaje_id DESC LIMIT 1`, [ctx.admin.id, ctx.e1.id]))[0];
    check('…y avisó por el chat a quien pujaba en su subasta abierta', r.data.pujadoresAvisados === 1 && /Suela crepé/.test(avisoBaja.ContenidoTexto) && /dada de baja/.test(avisoBaja.ContenidoTexto), JSON.stringify([r.data, avisoBaja]));
    check('…sin dejar calificaciones huérfanas', (await q(`SELECT count(*)::int n FROM calificaciones WHERE autor_id = $1 OR calificado_id = $2`, [ctx.p1.id, ctx.p1.id]))[0].n === 0);
    const restosP = (await q(`SELECT (SELECT count(*)::int FROM subastas WHERE proveedor_id=$1) s, (SELECT count(*)::int FROM ofertas WHERE proveedor_id=$2) o`, [ctx.p1.id, ctx.p1.id]))[0];
    check('…sin dejar subastas ni ofertas huérfanas', restosP.s === 0 && restosP.o === 0, JSON.stringify(restosP));
    r = await api('GET', '/api/chat/contactos', { token: ctx.p1.token });
    check('…y el token del usuario eliminado deja de funcionar (401)', r.status === 401);
    r = await api('DELETE', `/api/admin/usuarios/999999`, { token: ctx.admin.token });
    check('Eliminar usuario inexistente → 404', r.status === 404);
    check('Eliminar al proveedor 1 también borró del disco las fotos de sus ofertas', (await fetch(B + ctx.urlFotoP1)).status === 404);
}
