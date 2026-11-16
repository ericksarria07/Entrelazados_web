// 6. Borrar ofertas
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('6. Borrar ofertas');
    r = await api('DELETE', `/api/ofertas/${ctx.ofP1.OfertaID}`, { token: ctx.p2.token, body: { proveedorId: ctx.p1.id } });
    check('Proveedor 2 intenta borrar oferta del proveedor 1 (con ID falso) → 403', r.status === 403);
    r = await api('DELETE', `/api/ofertas/${ctx.ofP1.OfertaID}`, { token: ctx.p1.token });
    check('Proveedor 1 borra su propia oferta', r.status === 200);
    let filaSub = (await q(`SELECT estado, oferta_id FROM subastas WHERE subasta_id = $1`, [ctx.subP1.SubastaID]))[0];
    check('…su subasta YA VENCIDA con pujas no se cancela (el cierre le dará ganador) y queda sin OfertaID', filaSub.Estado === 'Activa' && filaSub.OfertaID === null, JSON.stringify(filaSub));
    const subOfP2 = (await q(`SELECT subasta_id FROM subastas WHERE oferta_id = $1`, [ctx.ofP2.OfertaID]))[0];
    r = await api('DELETE', `/api/ofertas/${ctx.ofP2.OfertaID}`, { token: ctx.admin.token });
    check('Admin puede borrar cualquier oferta', r.status === 200);
    filaSub = (await q(`SELECT estado FROM subastas WHERE subasta_id = $1`, [subOfP2.SubastaID]))[0];
    check('…y su subasta abierta queda "Cancelada" (ya no sigue activa sin publicación)', filaSub.Estado === 'Cancelada' && /también se canceló/.test(r.data.message), JSON.stringify([filaSub, r.data]));
    check('…y desaparece de /api/subastas', !(await api('GET', '/api/subastas')).data.some(x => x.SubastaID === subOfP2.SubastaID));
    r = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: subOfP2.SubastaID, montoPuja: 9999 } });
    check('…pujar en ella → 409 "fue cancelada"', r.status === 409 && /cancelada/.test(r.data.message), JSON.stringify(r));
}
