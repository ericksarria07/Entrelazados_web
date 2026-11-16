// 16. Crear subastas desde el Mercado
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q, B } from '../contexto.mjs';

export default async function correr(ctx) {
    let r, filaSub;
    seccion('16. Crear subastas desde el Mercado');
    const lote = { tituloLote: 'Suela de hule (lote)', precioBase: 300, categoriaId: 13, dias: 3 };
    r = await api('POST', '/api/subastas', { body: lote });
    check('Crear subasta sin sesión → 401', r.status === 401);
    r = await api('POST', '/api/subastas', { token: ctx.e1.token, body: lote });
    check('Emprendedor intenta crear subasta → 403', r.status === 403);
    for (const [nombre, cambio] of [['0 días', { dias: 0 }], ['30 días', { dias: 30 }], ['1,5 días', { dias: 1.5 }], ['precio negativo', { precioBase: -1 }],
        ['sin título', { tituloLote: '  ' }], ['sin categoría', { categoriaId: null }], ['título de 121 letras', { tituloLote: 'x'.repeat(121) }]]) {
        r = await api('POST', '/api/subastas', { token: ctx.p2.token, body: { ...lote, ...cambio } });
        check(`Subasta con ${nombre} → 400`, r.status === 400, JSON.stringify(r));
    }
    r = await api('POST', '/api/subastas', { token: ctx.p2.token, body: { ...lote, categoriaId: 9999 } });
    check('Subasta con una categoría que no existe → 400', r.status === 400 && /categoría/.test(r.data.message), JSON.stringify(r));
    r = await api('POST', '/api/subastas', { token: ctx.p2.token, body: { ...lote, proveedorId: ctx.p1.id } });
    check('Proveedor 2 crea un lote nuevo de 3 días (enviando proveedorId falso)', r.status === 201 && r.data.subastaId, JSON.stringify(r));
    const loteNuevo = (await q(`SELECT proveedor_id, oferta_id, categoria_id, titulo_lote, precio_actual, floor(extract(epoch FROM (fecha_fin - now())) / 3600)::int AS horas FROM subastas WHERE subasta_id = $1`, [r.data.subastaId]))[0];
    check('…queda a nombre del proveedor 2, sin publicación, con su categoría y precio', loteNuevo.ProveedorID === ctx.p2.id && loteNuevo.OfertaID === null && loteNuevo.CategoriaID === 13 && Number(loteNuevo.PrecioActual) === 300 && loteNuevo.TituloLote === 'Lote Subasta: Suela de hule (lote)', JSON.stringify(loteNuevo));
    check('…y cierra en 3 días', loteNuevo.horas >= 71 && loteNuevo.horas <= 72, `horas=${loteNuevo.horas}`);
    const enLista = (await api('GET', '/api/subastas')).data.find(x => x.SubastaID === r.data.subastaId);
    check('…y aparece en /api/subastas con su categoría', enLista && enLista.NombreCategoria === 'Suelas, Tacones y Tapas (Calzado)', JSON.stringify(enLista));

    // Desde una publicación: toma su título, categoría y fotos
    r = await ctx.publicarConFotos(ctx.p2.token, [{ datos: ctx.PNG, tipo: 'image/png', nombre: 'tachuelas.png' }], { titulo: 'Tachuelas de cobre', categoriaId: 7, precio: 80 });
    const ofTachuelas = r.data.ofertaId;
    const fotoTachuelas = r.data.fotos[0];
    r = await api('POST', '/api/subastas', { token: ctx.p2.token, body: { ofertaId: ofTachuelas, precioBase: 70 } });
    check('Subasta de una publicación que ya tiene subasta abierta → 409', r.status === 409 && /ya tiene una subasta abierta/.test(r.data.message), JSON.stringify(r));
    r = await api('POST', '/api/subastas', { token: ctx.p1.token, body: { ofertaId: ofTachuelas, precioBase: 70 } });
    check('Subasta con la publicación de otro proveedor → 404', r.status === 404, JSON.stringify(r));
    await q(`UPDATE subastas SET estado = 'Finalizada' WHERE oferta_id = $1`, [ofTachuelas]);
    const dobles = await Promise.all([1, 2, 3].map(() => api('POST', '/api/subastas', { token: ctx.p2.token, body: { ofertaId: ofTachuelas, precioBase: 70, categoriaId: 1 } })));
    check('3 clics a la vez para subastar la misma publicación: solo se crea UNA', dobles.filter(x => x.status === 201).length === 1 && dobles.filter(x => x.status === 409).length === 2, JSON.stringify(dobles.map(x => x.status)));
    const subTachuelas = (await api('GET', '/api/subastas')).data.find(x => x.OfertaID === ofTachuelas);
    check('…toma título, categoría (ignora la enviada) y foto de la publicación', subTachuelas && subTachuelas.TituloLote === 'Lote Subasta: Tachuelas de cobre' && subTachuelas.CategoriaID === 7 && subTachuelas.Foto === fotoTachuelas && Number(subTachuelas.PrecioBase) === 70, JSON.stringify(subTachuelas));

    // Borrar una publicación cuya subasta abierta tiene pujas
    r = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: subTachuelas.SubastaID, montoPuja: 75 } });
    check('Un emprendedor puja en la subasta de las tachuelas', r.status === 200, JSON.stringify(r));
    r = await api('DELETE', `/api/ofertas/${ofTachuelas}`, { token: ctx.p2.token });
    check('El proveedor NO puede borrar la publicación mientras su subasta tenga pujas → 409', r.status === 409 && r.data.pujas === 1 && /cuando la subasta cierre/.test(r.data.message), JSON.stringify(r));
    check('…la publicación y la subasta siguen igual', (await q(`SELECT count(*)::int n FROM ofertas WHERE oferta_id = $1`, [ofTachuelas]))[0].n === 1 && (await q(`SELECT estado FROM subastas WHERE subasta_id = $1`, [subTachuelas.SubastaID]))[0].Estado === 'Activa');
    r = await api('DELETE', `/api/admin/ofertas/${ofTachuelas}`, { token: ctx.admin.token });
    filaSub = (await q(`SELECT estado, oferta_id FROM subastas WHERE subasta_id = $1`, [subTachuelas.SubastaID]))[0];
    check('El admin sí puede (moderación): la subasta queda Cancelada y conserva sus pujas', r.status === 200 && filaSub.Estado === 'Cancelada' && filaSub.OfertaID === null && (await q(`SELECT count(*)::int n FROM pujas WHERE subasta_id = $1`, [subTachuelas.SubastaID]))[0].n === 1, JSON.stringify([r, filaSub]));
    check('…y la foto se borra del disco', (await fetch(B + fotoTachuelas)).status === 404);

    // Borrar una publicación cuya subasta no tiene pujas
    r = await api('POST', '/api/ofertas', { token: ctx.p2.token, body: { ...ctx.oferta, titulo: 'Cemento de contacto', categoriaId: 10 } });
    const subCemento = (await q(`SELECT subasta_id FROM subastas WHERE oferta_id = $1`, [r.data.ofertaId]))[0];
    r = await api('DELETE', `/api/ofertas/${r.data.ofertaId}`, { token: ctx.p2.token });
    check('El proveedor borra una publicación sin pujas: su subasta se cancela y se lo avisa', r.status === 200 && r.data.subastasCanceladas === 1 && /también se canceló/.test(r.data.message), JSON.stringify(r));
    check('…estado Cancelada en la base', (await q(`SELECT estado FROM subastas WHERE subasta_id = $1`, [subCemento.SubastaID]))[0].Estado === 'Cancelada');
}
