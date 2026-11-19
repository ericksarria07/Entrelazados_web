// 27. Favoritos y alertas de búsqueda
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('27. Favoritos y alertas de búsqueda');
    const pausa = (ms) => new Promise(res => setTimeout(res, ms));
    const avisos = async (usuario, tipo, refId) => (await q(
        `SELECT titulo, mensaje, enlace FROM notificaciones WHERE usuario_id = $1 AND tipo = $2 AND referencia_id = $3 ORDER BY notificacion_id`, [usuario.id, tipo, refId]));

    r = await api('GET', '/api/favoritos');
    check('Favoritos sin sesión → 401', r.status === 401);
    r = await api('GET', '/api/alertas');
    check('Alertas sin sesión → 401', r.status === 401);

    // Alertas: e1 busca cuero café de la categoría 1 hasta C$500; e3 cualquier "cuero"; perdedor... (e2) solo hasta C$100
    r = await api('POST', '/api/alertas', { token: ctx.e1.token, body: { palabraClave: '  Café  ', categoriaId: 1, precioMaximo: 500 } });
    const alertaE1 = r.data && r.data.alerta;
    check('Crear una alerta (palabra, categoría y precio máximo)', r.status === 201 && alertaE1.palabraClave === 'Café' && alertaE1.categoriaId === 1 && alertaE1.precioMaximo === 500 && /«Café» en .+ hasta C\$500/.test(alertaE1.descripcion), JSON.stringify(r));
    r = await api('POST', '/api/alertas', { token: ctx.e1.token, body: { palabraClave: 'Café', categoriaId: 1, precioMaximo: 500 } });
    check('Una alerta igual otra vez → 409', r.status === 409, JSON.stringify(r));
    r = await api('POST', '/api/alertas', { token: ctx.e1.token, body: {} });
    check('Alerta sin palabra ni categoría → 400', r.status === 400);
    r = await api('POST', '/api/alertas', { token: ctx.e1.token, body: { palabraClave: 'suela', precioMaximo: -3 } });
    check('Alerta con precio negativo → 400', r.status === 400);
    r = await api('POST', '/api/alertas', { token: ctx.e1.token, body: { categoriaId: 99999 } });
    check('Alerta con una categoría que no existe → 400', r.status === 400, JSON.stringify(r));
    r = await api('POST', '/api/alertas', { token: ctx.e3.token, body: { palabraClave: 'cuero' } });
    check('Otra persona crea su alerta "cuero"', r.status === 201);
    r = await api('POST', '/api/alertas', { token: ctx.e2.token, body: { palabraClave: 'cuero', precioMaximo: 100 } });
    const alertaE2 = r.data && r.data.alerta;
    check('…y otra con precio máximo C$100', r.status === 201);
    r = await api('POST', '/api/alertas', { token: ctx.p3.token, body: { palabraClave: 'cuero' } });
    check('Un proveedor también puede tener alertas', r.status === 201);
    const extras = [];
    for (let i = 1; i <= 9; i++) extras.push(await api('POST', '/api/alertas', { token: ctx.e1.token, body: { palabraClave: `palabra${i}` } }));
    check('Se pueden tener hasta 10 alertas', extras.every(x => x.status === 201), JSON.stringify(extras.map(x => x.status)));
    r = await api('POST', '/api/alertas', { token: ctx.e1.token, body: { palabraClave: 'once' } });
    check('…la número 11 → 409', r.status === 409 && /10 alertas/.test(r.data.message), JSON.stringify(r));
    r = await api('DELETE', `/api/alertas/${extras[0].data.alerta.id}`, { token: ctx.e3.token });
    check('Borrar la alerta de otra persona → 404', r.status === 404);
    for (const x of extras) await api('DELETE', `/api/alertas/${x.data.alerta.id}`, { token: ctx.e1.token });
    r = await api('GET', '/api/alertas', { token: ctx.e1.token });
    check('Borrar mis alertas: queda solo la primera', r.status === 200 && r.data.length === 1 && r.data[0].id === alertaE1.id, JSON.stringify(r.data));

    // Publicar algo que cumple: avisa a quien corresponde
    r = await api('POST', '/api/ofertas', { token: ctx.p3.token, body: { titulo: 'Cuero vacuno CAFE curtido', descripcion: '  Ideal para botas y cinturones.  ', precio: 450, unidad: 'por pie²', categoriaId: 1, distancia: 5 } });
    ctx.ofCafe = r.data && r.data.ofertaId;
    check('Publicar con descripción', r.status === 200 && ctx.ofCafe > 0, JSON.stringify(r));
    check('…la descripción se guarda limpia', (await q(`SELECT descripcion FROM ofertas WHERE oferta_id = $1`, [ctx.ofCafe]))[0].Descripcion === 'Ideal para botas y cinturones.');
    await pausa(500);
    const alertaRecibidaE1 = await avisos(ctx.e1, 'AlertaBusqueda', ctx.ofCafe);
    check('La alerta de "Café" (sin tilde en el título) avisa con enlace a la publicación', alertaRecibidaE1.length === 1 && alertaRecibidaE1[0].Enlace === `/mercado?oferta=${ctx.ofCafe}` && /Cuero vacuno CAFE/.test(alertaRecibidaE1[0].Titulo), JSON.stringify(alertaRecibidaE1));
    check('…también a quien buscaba "cuero"', (await avisos(ctx.e3, 'AlertaBusqueda', ctx.ofCafe)).length === 1);
    check('…pero no a quien solo quería hasta C$100', (await avisos(ctx.e2, 'AlertaBusqueda', ctx.ofCafe)).length === 0);
    check('…ni al proveedor que publicó (aunque tenga una alerta que cumple)', (await avisos(ctx.p3, 'AlertaBusqueda', ctx.ofCafe)).length === 0);
    r = await api('POST', '/api/ofertas', { token: ctx.p3.token, body: { titulo: 'Cuero café premium', precio: 650, unidad: 'por pie²', categoriaId: 1 } });
    const ofCara = r.data.ofertaId;
    await pausa(500);
    check('Una publicación más cara que el precio máximo no avisa', (await avisos(ctx.e1, 'AlertaBusqueda', ofCara)).length === 0 && (await avisos(ctx.e3, 'AlertaBusqueda', ofCara)).length === 1);

    r = await api('GET', `/api/ofertas?id=${ctx.ofCafe}`);
    check('GET /api/ofertas?id= trae solo esa publicación, con su descripción', r.status === 200 && r.data.length === 1 && r.data[0].Descripcion === 'Ideal para botas y cinturones.', JSON.stringify(r.data));
    r = await api('GET', '/api/ofertas?q=cinturones');
    check('La búsqueda también encuentra palabras de la descripción', r.data.some(o => o.OfertaID === ctx.ofCafe));

    // Favoritos
    r = await api('POST', `/api/favoritos/${ctx.ofCafe}`, { token: ctx.e1.token });
    check('Guardar una publicación en favoritos → 201', r.status === 201, JSON.stringify(r));
    r = await api('POST', `/api/favoritos/${ctx.ofCafe}`, { token: ctx.e1.token });
    check('…guardarla otra vez → 200 (no se duplica)', r.status === 200 && (await q(`SELECT count(*)::int n FROM favoritos WHERE usuario_id = $1`, [ctx.e1.id]))[0].n === 1);
    r = await api('POST', `/api/favoritos/${ctx.ofCafe}`, { token: ctx.p3.token });
    check('No puedo guardar mi propia publicación → 400', r.status === 400);
    r = await api('POST', '/api/favoritos/999999', { token: ctx.e1.token });
    check('Guardar una publicación que no existe → 404', r.status === 404);
    r = await api('POST', '/api/favoritos/abc', { token: ctx.e1.token });
    check('…o con un número inválido → 404', r.status === 404);
    r = await api('GET', '/api/favoritos/ids', { token: ctx.e1.token });
    check('/api/favoritos/ids', r.status === 200 && JSON.stringify(r.data) === JSON.stringify([ctx.ofCafe]), JSON.stringify(r.data));
    r = await api('GET', '/api/favoritos', { token: ctx.e1.token });
    check('/api/favoritos trae la publicación completa', r.status === 200 && r.data.length === 1 && r.data[0].TituloMaterial === 'Cuero vacuno CAFE curtido' && r.data[0].NombreProveedor === 'Curtiembre Tres' && Array.isArray(r.data[0].Fotos), JSON.stringify(r.data));
    await api('POST', `/api/favoritos/${ofCara}`, { token: ctx.e3.token });

    // Bajar el precio avisa a quien la guardó; subirlo no
    r = await ctx.formulario('PUT', `/api/ofertas/${ctx.ofCafe}`, ctx.p3.token, { titulo: 'Cuero vacuno CAFE curtido', precio: 400, unidad: 'por pie²', categoriaId: 1, descripcion: 'Ideal para botas.' });
    check('El proveedor baja el precio', r.status === 200, JSON.stringify(r));
    await pausa(500);
    const rebaja = await avisos(ctx.e1, 'FavoritoRebajado', ctx.ofCafe);
    check('…y quien la guardó recibe "Bajó de precio" (C$450 → C$400)', rebaja.length === 1 && /450\.00/.test(rebaja[0].Mensaje) && /400\.00/.test(rebaja[0].Mensaje), JSON.stringify(rebaja));
    await ctx.formulario('PUT', `/api/ofertas/${ctx.ofCafe}`, ctx.p3.token, { titulo: 'Cuero vacuno CAFE curtido', precio: 420, unidad: 'por pie²', categoriaId: 1 });
    await pausa(400);
    check('Subir el precio no avisa', (await avisos(ctx.e1, 'FavoritoRebajado', ctx.ofCafe)).length === 1);
    check('Editar sin descripción la deja vacía (NULL)', (await q(`SELECT descripcion FROM ofertas WHERE oferta_id = $1`, [ctx.ofCafe]))[0].Descripcion === null);

    r = await api('DELETE', `/api/ofertas/${ofCara}`, { token: ctx.p3.token });
    check('Borrar una publicación guardada también borra el favorito', r.status === 200 && (await q(`SELECT count(*)::int n FROM favoritos WHERE oferta_id = $1`, [ofCara]))[0].n === 0, JSON.stringify(r));
    r = await api('DELETE', `/api/favoritos/${ctx.ofCafe}`, { token: ctx.e1.token });
    check('Quitar de favoritos', r.status === 200 && r.data.quitada === true);
    r = await api('DELETE', `/api/favoritos/${ctx.ofCafe}`, { token: ctx.e1.token });
    check('…quitarla otra vez responde quitada: false', r.status === 200 && r.data.quitada === false);
    await api('POST', `/api/favoritos/${ctx.ofCafe}`, { token: ctx.e1.token });
    await api('DELETE', `/api/alertas/${alertaE2.id}`, { token: ctx.e2.token });
}
