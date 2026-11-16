// 7. Chat
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('7. Chat');
    r = await api('GET', '/api/chat/contactos');
    check('Contactos sin sesión → 401', r.status === 401);
    r = await api('GET', '/api/chat/contactos', { token: ctx.e1.token });
    check('Contactos no incluyen al propio usuario', r.status === 200 && !r.data.some(c => c.UsuarioID === ctx.e1.id) && r.data.length >= 4);
    r = await api('POST', '/api/chat/enviar', { token: ctx.e1.token, body: { remitenteId: ctx.p2.id, destinatarioId: ctx.p1.id, texto: 'Hola, ¿tiene cuero en stock?' } });
    check('Emprendedor 1 escribe a proveedor 1 (con remitenteId falso)', r.status === 200);
    const msg = (await q(`SELECT remitente_id FROM mensajes_chat ORDER BY mensaje_id DESC LIMIT 1`))[0];
    check('El mensaje quedó a nombre del emprendedor 1', msg.RemitenteID === ctx.e1.id);
    await api('POST', '/api/chat/enviar', { token: ctx.e2.token, body: { destinatarioId: ctx.p1.id, texto: '<img src=x onerror="window.__xss=1">' } });
    r = await api('GET', `/api/chat/mensajes?remitenteId=${ctx.e1.id}&destinatarioId=${ctx.p1.id}`, { token: ctx.p2.token });
    check('Proveedor 2 NO puede leer la conversación emprendedor 1 ↔ proveedor 1', r.status === 200 && r.data.length === 0, JSON.stringify(r.data));
    r = await api('GET', `/api/chat/mensajes?destinatarioId=${ctx.e1.id}`, { token: ctx.p1.token });
    check('Proveedor 1 sí ve su conversación con emprendedor 1', r.status === 200 && r.data.length === 1);
    r = await api('POST', '/api/chat/enviar', { token: ctx.e1.token, body: { destinatarioId: ctx.e1.id, texto: 'yo' } });
    check('Enviarse mensajes a sí mismo → 400', r.status === 400);
    r = await api('POST', '/api/chat/enviar', { token: ctx.e1.token, body: { destinatarioId: ctx.p1.id, texto: 'x'.repeat(2001) } });
    check('Mensaje de más de 2000 caracteres → 400', r.status === 400);
}
