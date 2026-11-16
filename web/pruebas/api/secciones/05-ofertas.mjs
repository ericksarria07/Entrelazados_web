// 4. Ofertas
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('4. Ofertas');
    ctx.oferta = { titulo: 'Cuero vacuno curtido', precio: 450, unidad: 'pie²', distancia: 12, categoriaId: 1, fotos: [] };
    r = await api('POST', '/api/ofertas', { body: ctx.oferta });
    check('Publicar sin sesión → 401', r.status === 401);
    r = await api('POST', '/api/ofertas', { token: ctx.e1.token, body: ctx.oferta });
    check('Emprendedor intenta publicar → 403', r.status === 403);
    r = await api('POST', '/api/ofertas', { token: ctx.p1.token, body: { ...ctx.oferta, proveedorId: ctx.p2.id } });
    check('Proveedor 1 publica (enviando proveedorId falso del proveedor 2)', r.status === 200, JSON.stringify(r));
    r = await api('POST', '/api/ofertas', { token: ctx.p2.token, body: { ...ctx.oferta, titulo: 'Suela de hule', precio: 120 } });
    check('Proveedor 2 publica', r.status === 200);
    r = await api('POST', '/api/ofertas', { token: ctx.p1.token, body: { ...ctx.oferta, precio: -5 } });
    check('Precio negativo → 400', r.status === 400);
    const ofertas = (await api('GET', '/api/ofertas')).data;
    ctx.ofP1 = ofertas.find(o => o.TituloMaterial === 'Cuero vacuno curtido');
    ctx.ofP2 = ofertas.find(o => o.TituloMaterial === 'Suela de hule');
    check('La oferta quedó a nombre del proveedor 1 (se ignoró el ID falso)', ctx.ofP1 && ctx.ofP1.ProveedorID === ctx.p1.id, JSON.stringify(ctx.ofP1));
    check('/api/ofertas incluye el CategoriaID (para filtrar por categoría)', ctx.ofP1 && ctx.ofP1.CategoriaID === 1 && ctx.ofP1.NombreCategoria === 'Cuero Bovino / Vacuno', JSON.stringify(ctx.ofP1));
    await q(`UPDATE ofertas SET fotos = '{no es json' WHERE oferta_id = $1`, [ctx.ofP2.OfertaID]);
    r = await api('GET', '/api/ofertas');
    check('Fotos con JSON dañado no tumban /api/ofertas', r.status === 200 && r.data.length === 2);
}
