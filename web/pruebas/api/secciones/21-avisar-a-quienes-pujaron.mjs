// 22. Avisar a quienes pujaron si se cancela una subasta
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('22. Avisar a quienes pujaron si se cancela una subasta');
    r = await api('POST', '/api/ofertas', { token: ctx.p3.token, body: { titulo: 'Hilo encerado 1mm', precio: 40, unidad: 'rollo', distancia: 3, categoriaId: 9 } });
    const ofHilo = r.data.ofertaId;
    const subHilo = (await q(`SELECT subasta_id FROM subastas WHERE oferta_id = $1`, [ofHilo]))[0].SubastaID;
    const pujaHilo1 = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: subHilo, montoPuja: 45 } });
    const pujaHilo2 = await api('POST', '/api/pujas', { token: ctx.e2.token, body: { subastaId: subHilo, montoPuja: 50 } });
    const pujaHilo3 = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: subHilo, montoPuja: 55 } });
    check('Dos emprendedores pujan (uno de ellos dos veces)', [pujaHilo1, pujaHilo2, pujaHilo3].every(x => x.status === 200));
    r = await api('DELETE', `/api/admin/ofertas/${ofHilo}`, { token: ctx.admin.token });
    check('El admin retira la publicación: avisa a las 2 personas que pujaron', r.status === 200 && r.data.pujadoresAvisados === 2 && /Avisamos por el chat a 2/.test(r.data.message), JSON.stringify(r));
    const avisoE1 = await q(`SELECT contenido_texto FROM mensajes_chat WHERE remitente_id = $1 AND destinatario_id = $2 AND contenido_texto LIKE $3`, [ctx.admin.id, ctx.e1.id, '%Hilo encerado 1mm%']);
    const avisoE2 = await q(`SELECT contenido_texto FROM mensajes_chat WHERE remitente_id = $1 AND destinatario_id = $2 AND contenido_texto LIKE $3`, [ctx.admin.id, ctx.e2.id, '%Hilo encerado 1mm%']);
    check('…cada una recibe UN mensaje que explica la cancelación', avisoE1.length === 1 && avisoE2.length === 1 && /cancelada por moderación del administrador/.test(avisoE1[0].ContenidoTexto), JSON.stringify(avisoE1));
    // Para la sección 12: una subasta abierta del proveedor 1 con una puja del emprendedor 1
    r = await api('POST', '/api/ofertas', { token: ctx.p1.token, body: { titulo: 'Suela crepé', precio: 60, unidad: 'par', distancia: 2, categoriaId: 13 } });
    const subSuela = (await q(`SELECT subasta_id FROM subastas WHERE oferta_id = $1`, [r.data.ofertaId]))[0].SubastaID;
    r = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: subSuela, montoPuja: 65 } });
    check('El emprendedor 1 puja en una subasta abierta del proveedor 1', r.status === 200, JSON.stringify(r));
}
