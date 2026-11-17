// 13. Fotos de las ofertas
// En Vercel las fotos van a Vercel Blob; aquí (sin BLOB_READ_WRITE_TOKEN) se guardan en disco y se sirven en /uploads.
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q, B } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('13. Fotos de las ofertas');
    ctx.PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    ctx.WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
    const campos = { titulo: 'Hebillas de bronce', precio: 35, unidad: 'docena', distancia: 4, categoriaId: 6 };
    ctx.publicarConFotos = async function publicarConFotos(token, archivos, extra = {}) {
        const fd = new FormData();
        for (const [k, v] of Object.entries({ ...campos, ...extra })) fd.append(k, String(v));
        for (const a of archivos) fd.append('fotos', new Blob([a.datos], { type: a.tipo }), a.nombre);
        const resp = await fetch(B + '/api/ofertas', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd });
        let data = null;
        try { data = await resp.json(); } catch { /* respuesta sin JSON */ }
        return { status: resp.status, data };
    };
    const contarOfertas = async () => (await q(`SELECT count(*)::int n FROM ofertas`))[0].n;
    const ofertasAntes = await contarOfertas();

    r = await ctx.publicarConFotos(null, [{ datos: ctx.PNG, tipo: 'image/png', nombre: 'a.png' }]);
    check('Subir fotos sin sesión → 401', r.status === 401);
    r = await ctx.publicarConFotos(ctx.e1.token, [{ datos: ctx.PNG, tipo: 'image/png', nombre: 'a.png' }]);
    check('Emprendedor intenta publicar con fotos → 403', r.status === 403);
    r = await ctx.publicarConFotos(ctx.p2.token, [{ datos: Buffer.from('<script>alert(1)</script>'), tipo: 'image/png', nombre: 'falsa.png' }]);
    check('Archivo de texto disfrazado de PNG → 400', r.status === 400 && /no es una imagen/.test(r.data.message), JSON.stringify(r));
    r = await ctx.publicarConFotos(ctx.p2.token, [{ datos: Buffer.from('GIF89a'), tipo: 'image/gif', nombre: 'a.gif' }]);
    check('GIF (tipo no permitido) → 400', r.status === 400 && /JPG, PNG o WebP/.test(r.data.message), JSON.stringify(r));
    r = await ctx.publicarConFotos(ctx.p2.token, Array.from({ length: 6 }, (_, i) => ({ datos: ctx.PNG, tipo: 'image/png', nombre: `f${i}.png` })));
    check('6 fotos (máximo 5) → 400', r.status === 400 && /máximo 5/.test(r.data.message), JSON.stringify(r));
    r = await ctx.publicarConFotos(ctx.p2.token, [{ datos: Buffer.concat([ctx.PNG, Buffer.alloc(5.5 * 1024 * 1024)]), tipo: 'image/png', nombre: 'grande.png' }]);
    check('Foto de 5,5 MB (máximo 5 MB) → 400', r.status === 400 && /5 MB/.test(r.data.message), JSON.stringify(r));
    check('…y ninguno de los intentos rechazados creó una oferta', await contarOfertas() === ofertasAntes);

    r = await ctx.publicarConFotos(ctx.p2.token, [{ datos: ctx.PNG, tipo: 'image/png', nombre: 'frente.png' }, { datos: ctx.WEBP, tipo: 'image/webp', nombre: 'lado.webp' }]);
    check('Proveedor publica con 2 fotos (PNG y WebP)', r.status === 200 && r.data.fotos.length === 2, JSON.stringify(r));
    const urlsP2 = r.data.fotos || [];
    check('…los archivos reciben un nombre aleatorio del servidor', urlsP2.every(u => /^\/uploads\/ofertas\/[0-9a-f-]{36}\.(png|webp)$/.test(u)), JSON.stringify(urlsP2));
    let foto = await fetch(B + urlsP2[0]);
    check('…la foto se puede ver en el navegador (200, image/png, nosniff)', foto.status === 200 && foto.headers.get('content-type') === 'image/png' && foto.headers.get('x-content-type-options') === 'nosniff', `${foto.status} ${foto.headers.get('content-type')}`);
    const ofertaConFotos = (await api('GET', '/api/ofertas')).data.find(o => o.OfertaID === r.data.ofertaId);
    check('…/api/ofertas devuelve sus 2 fotos con la principal primero', ofertaConFotos && JSON.stringify(ofertaConFotos.Fotos) === JSON.stringify(urlsP2), JSON.stringify(ofertaConFotos));
    const filasFotos = await q(`SELECT es_principal FROM fotos_ofertas WHERE oferta_id = $1 ORDER BY foto_id`, [r.data.ofertaId]);
    check('…se guardan en FotosOfertas (no como texto en Ofertas.Fotos)', filasFotos.length === 2 && filasFotos[0].EsPrincipal === 1 && filasFotos[1].EsPrincipal === 0);

    const sinFotos = await api('POST', '/api/ofertas', { token: ctx.p2.token, body: { ...campos, titulo: 'Oferta antigua' } });
    await q(`UPDATE ofertas SET fotos = $1 WHERE oferta_id = $2`, [JSON.stringify(['data:image/png;base64,AAAA']), sinFotos.data.ofertaId]);
    const antigua = (await api('GET', '/api/ofertas')).data.find(o => o.OfertaID === sinFotos.data.ofertaId);
    check('Ofertas antiguas con fotos en texto se siguen mostrando', antigua && antigua.Fotos[0] === 'data:image/png;base64,AAAA', JSON.stringify(antigua));
    const subConFotos = (await api('GET', '/api/subastas')).data.find(x => x.OfertaID === r.data.ofertaId);
    check('La subasta muestra la foto principal de su publicación', subConFotos && subConFotos.Foto === urlsP2[0], JSON.stringify(subConFotos));
    const subAntigua = (await api('GET', '/api/subastas')).data.find(x => x.OfertaID === sinFotos.data.ofertaId);
    check('…también con las fotos antiguas en texto', subAntigua && subAntigua.Foto === 'data:image/png;base64,AAAA', JSON.stringify(subAntigua));

    foto = await fetch(B + '/uploads/%2e%2e/index.js');
    const textoFoto = await foto.text();
    check('/uploads no permite salir de la carpeta (../index.js)', foto.status === 404 && !textoFoto.includes('require('), `${foto.status}`);

    r = await api('DELETE', `/api/ofertas/${r.data.ofertaId}`, { token: ctx.p2.token });
    check('Borrar la oferta con fotos', r.status === 200);
    foto = await fetch(B + urlsP2[0]);
    check('…también borra los archivos del disco (404)', foto.status === 404 && (await fetch(B + urlsP2[1])).status === 404);
    r = await ctx.publicarConFotos(ctx.p1.token, [{ datos: ctx.PNG, tipo: 'image/png', nombre: 'p1.png' }], { titulo: 'Ojalillos niquelados' });
    check('Proveedor 1 publica con foto (para la prueba de eliminar usuario)', r.status === 200, JSON.stringify(r));
    ctx.urlFotoP1 = r.data.fotos[0];
}
