// 20. Mensajes no leídos
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('20. Mensajes no leídos');
    r = await api('GET', '/api/chat/no-leidos');
    check('Contador sin sesión → 401', r.status === 401);
    const noLeidosAntes = (await api('GET', '/api/chat/no-leidos', { token: ctx.e1.token })).data;
    await api('POST', '/api/chat/enviar', { token: ctx.p3.token, body: { destinatarioId: ctx.e1.id, texto: '¿Le interesa la badana?' } });
    await api('POST', '/api/chat/enviar', { token: ctx.p3.token, body: { destinatarioId: ctx.e1.id, texto: 'Tengo 40 pies' } });
    r = await api('GET', '/api/chat/no-leidos', { token: ctx.e1.token });
    check('El emprendedor tiene 2 mensajes sin leer del proveedor 3', r.data.porContacto[ctx.p3.id] === 2 && r.data.total === noLeidosAntes.total + 2, JSON.stringify([noLeidosAntes, r.data]));
    r = await api('GET', '/api/chat/contactos', { token: ctx.e1.token });
    check('…en sus contactos aparece primero alguien con mensajes sin leer, y el proveedor 3 con 2', r.data[0].NoLeidos > 0 && r.data.find(c => c.UsuarioID === ctx.p3.id).NoLeidos === 2, JSON.stringify(r.data.slice(0, 3)));
    await api('GET', `/api/chat/mensajes?destinatarioId=${ctx.p3.id}`, { token: ctx.p2.token });
    check('Que otra persona abra SU chat con el proveedor 3 no los marca leídos', (await api('GET', '/api/chat/no-leidos', { token: ctx.e1.token })).data.porContacto[ctx.p3.id] === 2);
    r = await api('GET', `/api/chat/mensajes?destinatarioId=${ctx.p3.id}`, { token: ctx.e1.token });
    check('Al abrir la conversación se ven los 2 mensajes', r.status === 200 && r.data.length === 2);
    r = await api('GET', '/api/chat/no-leidos', { token: ctx.e1.token });
    check('…y quedan leídos (el contador baja)', !r.data.porContacto[ctx.p3.id] && r.data.total === noLeidosAntes.total, JSON.stringify(r.data));
    r = await api('GET', `/api/chat/mensajes?destinatarioId=${ctx.e1.id}`, { token: ctx.p3.token });
    check('El proveedor 3 ve sus mensajes como "Visto"', r.data.length === 2 && r.data.every(m => m.EsLeido === true), JSON.stringify(r.data));
}
