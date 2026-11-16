// 18. Editar publicaciones
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q, B } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('18. Editar publicaciones');
    // Un proveedor nuevo, para no gastar el límite de publicaciones por hora del proveedor 2
    r = await ctx.reg('prov3@prueba.com', 'Proveedor', { nombre: 'Curtiembre Tres' });
    await ctx.verificar('prov3@prueba.com');
    ctx.p3 = (await ctx.login('prov3@prueba.com', 'Clave123')).data;
    check('Proveedor 3 se registra, confirma su correo y entra', ctx.p3 && ctx.p3.token, JSON.stringify(ctx.p3));
    ctx.formulario = async function formulario(metodo, ruta, token, campos, archivos = []) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
        for (const a of archivos) fd.append('fotos', new Blob([a.datos], { type: a.tipo }), a.nombre);
        const resp = await fetch(B + ruta, { method: metodo, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd });
        let data = null;
        try { data = await resp.json(); } catch { /* respuesta sin JSON */ }
        return { status: resp.status, data };
    };
    r = await ctx.formulario('POST', '/api/ofertas', ctx.p3.token, { titulo: 'Badana cruda', precio: 90, unidad: 'pie²', distancia: 8, categoriaId: 1 },
        [{ datos: ctx.PNG, tipo: 'image/png', nombre: 'a.png' }, { datos: ctx.WEBP, tipo: 'image/webp', nombre: 'b.webp' }]);
    ctx.ofEditar = r.data.ofertaId;
    const [fotoA, fotoB] = r.data.fotos;
    ctx.subEditar = (await q(`SELECT subasta_id FROM subastas WHERE oferta_id = $1`, [ctx.ofEditar]))[0].SubastaID;
    const cambios = { titulo: 'Badana curtida al vegetal', precio: 110, unidad: 'pie²', distancia: 5, categoriaId: 2 };

    r = await api('PUT', `/api/ofertas/${ctx.ofEditar}`, { body: cambios });
    check('Editar sin sesión → 401', r.status === 401);
    r = await api('PUT', `/api/ofertas/${ctx.ofEditar}`, { token: ctx.e1.token, body: cambios });
    check('Un emprendedor intenta editar → 403', r.status === 403);
    r = await api('PUT', `/api/ofertas/${ctx.ofEditar}`, { token: ctx.p2.token, body: cambios });
    check('Otro proveedor intenta editarla → 404 (no es suya)', r.status === 404, JSON.stringify(r));
    r = await api('PUT', '/api/ofertas/999999', { token: ctx.p3.token, body: cambios });
    check('Editar una publicación que no existe → 404', r.status === 404);
    for (const [nombre, cambio] of [['precio 0', { precio: 0 }], ['sin título', { titulo: ' ' }], ['unidad de 31 letras', { unidad: 'x'.repeat(31) }], ['fotosQuitar que no es lista', { fotosQuitar: { a: 1 } }]]) {
        r = await api('PUT', `/api/ofertas/${ctx.ofEditar}`, { token: ctx.p3.token, body: { ...cambios, ...cambio } });
        check(`Editar con ${nombre} → 400`, r.status === 400, JSON.stringify(r));
    }
    r = await api('PUT', `/api/ofertas/${ctx.ofEditar}`, { token: ctx.p3.token, body: { ...cambios, categoriaId: 9999 } });
    check('Editar con una categoría que no existe → 400', r.status === 400 && /categoría/.test(r.data.message), JSON.stringify(r));
    check('…ningún intento rechazado cambió la publicación', (await q(`SELECT titulo_material FROM ofertas WHERE oferta_id = $1`, [ctx.ofEditar]))[0].TituloMaterial === 'Badana cruda');

    r = await ctx.formulario('PUT', `/api/ofertas/${ctx.ofEditar}`, ctx.p3.token, { ...cambios, fotosQuitar: JSON.stringify([fotoA]) }, [{ datos: ctx.PNG, tipo: 'image/png', nombre: 'c.png' }]);
    check('El dueño cambia datos, quita una foto y agrega otra', r.status === 200 && r.data.fotos.length === 2 && r.data.fotos[0] === fotoB && !r.data.fotos.includes(fotoA), JSON.stringify(r));
    const filaEditada = (await q(`SELECT titulo_material, precio, categoria_id, distancia_simulada_km FROM ofertas WHERE oferta_id = $1`, [ctx.ofEditar]))[0];
    check('…los datos nuevos quedan guardados', filaEditada.TituloMaterial === cambios.titulo && Number(filaEditada.Precio) === 110 && filaEditada.CategoriaID === 2 && filaEditada.DistanciaSimuladaKm === 5, JSON.stringify(filaEditada));
    check('…la foto quitada se borra del disco', (await fetch(B + fotoA)).status === 404 && (await fetch(B + r.data.fotos[1])).status === 200);
    const principales = await q(`SELECT foto_url FROM fotos_ofertas WHERE oferta_id = $1 AND es_principal = true`, [ctx.ofEditar]);
    check('…y la que queda primero pasa a ser la principal (solo una)', principales.length === 1 && principales[0].FotoURL === fotoB, JSON.stringify(principales));
    const subEditada = (await q(`SELECT titulo_lote, categoria_id, precio_base FROM subastas WHERE subasta_id = $1`, [ctx.subEditar]))[0];
    check('…su subasta abierta toma el título y la categoría nuevos (el precio no cambia)', subEditada.TituloLote === 'Lote Subasta: Badana curtida al vegetal' && subEditada.CategoriaID === 2 && Number(subEditada.PrecioBase) === 90, JSON.stringify(subEditada));

    r = await ctx.formulario('PUT', `/api/ofertas/${ctx.ofEditar}`, ctx.p3.token, cambios, Array.from({ length: 4 }, (_, i) => ({ datos: ctx.PNG, tipo: 'image/png', nombre: `n${i}.png` })));
    check('Pasar de 5 fotos en total → 400', r.status === 400 && /máximo 5/.test(r.data.message), JSON.stringify(r));
    check('…y no quedan fotos de más', (await q(`SELECT count(*)::int n FROM fotos_ofertas WHERE oferta_id = $1`, [ctx.ofEditar]))[0].n === 2);
    r = await api('PUT', `/api/ofertas/${ctx.ofEditar}`, { token: ctx.admin.token, body: { ...cambios, titulo: 'Badana curtida (revisada)' } });
    check('El administrador también puede editarla (sin tocar las fotos)', r.status === 200 && r.data.fotos.length === 2, JSON.stringify(r));
}
