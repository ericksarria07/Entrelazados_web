// 30. Asistente de IA para publicar
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { estadisticas, normalizarUnidad, redondearPrecio } from '../../../lib/reglas-precio.ts';
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('30. Asistente de IA para publicar');
    r = await api('POST', '/api/ia/precio', { body: { categoriaId: 1 } });
    check('Sin sesión → 401', r.status === 401);
    r = await api('POST', '/api/ia/precio', { token: ctx.e1.token, body: { categoriaId: 1 } });
    check('Un emprendedor no puede usarlo → 403', r.status === 403);
    r = await api('POST', '/api/ia/precio', { token: ctx.p3.token, body: { titulo: 'Cuero' } });
    check('Sugerir precio sin categoría → 400', r.status === 400);
    r = await api('POST', '/api/ia/precio', { token: ctx.p3.token, body: { categoriaId: 99999 } });
    check('…con una categoría que no existe → 400', r.status === 400);
    // Para comparar: otro precio de cuero por pie² (de p2) además de los que ya hay en la categoría 1
    await api('POST', '/api/ofertas', { token: ctx.p2.token, body: { titulo: 'Cuero vacuno negro', precio: 500, unidad: 'pie2', categoriaId: 1 } });
    const preciosPie2 = [
        ...(await q(`SELECT precio AS p, unidad_medida AS u FROM ofertas WHERE categoria_id = 1`)),
        ...(await q(`SELECT t.monto_total AS p, o.unidad_medida AS u FROM tratos_cerrados t
                     JOIN subastas s ON t.tipo_origen = 'Subasta' AND s.subasta_id = t.origen_id
                     JOIN ofertas o ON o.oferta_id = s.oferta_id
                     WHERE s.categoria_id = 1 AND t.estado_trato <> 'Cancelado'`))
    ].filter(x => normalizarUnidad(x.u) === 'pie2').map(x => Number(x.p));
    const esperado = estadisticas(preciosPie2);
    r = await api('POST', '/api/ia/precio', { token: ctx.p3.token, body: { titulo: 'Cuero vacuno', categoriaId: 1, unidad: 'por pie²' } });
    const sug = r.data;
    check('Sugiere un precio comparando la misma unidad (sin Gemini: la mediana)', r.status === 200 && sug.fuente === 'estadistica' && sug.mismaUnidad === true
        && sug.muestras === esperado.muestras && sug.sugerido === redondearPrecio(esperado.mediana) && sug.rango.minimo === esperado.minimo && sug.rango.maximo === esperado.maximo,
        JSON.stringify([sug, esperado]));
    check('…con una explicación y ejemplos', /mediana/.test(sug.explicacion) && sug.ejemplos.length >= 2 && sug.ejemplos.length <= 5, JSON.stringify(sug.ejemplos));
    r = await api('POST', '/api/ia/precio', { token: ctx.p3.token, body: { categoriaId: 1, unidad: 'por pie²', ofertaId: ctx.ofCafe } });
    check('Al editar no se compara consigo misma', r.status === 200 && r.data.muestras === sug.muestras - 1, JSON.stringify(r.data));
    r = await api('POST', '/api/ia/precio', { token: ctx.p3.token, body: { categoriaId: 14 } });
    check('Sin publicaciones parecidas no inventa un precio', r.status === 200 && r.data.sugerido === null && r.data.fuente === 'sin-datos', JSON.stringify(r.data));
    r = await ctx.formulario('POST', '/api/ia/publicacion', ctx.p3.token, {});
    check('Describir sin foto ni título → 400', r.status === 400, JSON.stringify(r));
    r = await ctx.formulario('POST', '/api/ia/publicacion', ctx.p3.token, {}, [{ datos: ctx.PNG, tipo: 'image/png', nombre: 'a.png' }, { datos: ctx.PNG, tipo: 'image/png', nombre: 'b.png' }]);
    check('…con dos fotos → 400', r.status === 400 && /una sola foto/.test(r.data.message), JSON.stringify(r));
    r = await ctx.formulario('POST', '/api/ia/publicacion', ctx.p3.token, {}, [{ datos: Buffer.from('no soy imagen'), tipo: 'image/png', nombre: 'falsa.png' }]);
    check('…con un archivo que no es imagen → 400', r.status === 400, JSON.stringify(r));
    r = await ctx.formulario('POST', '/api/ia/publicacion', ctx.e1.token, { titulo: 'Cuero' });
    check('…un emprendedor → 403', r.status === 403);
    r = await ctx.formulario('POST', '/api/ia/publicacion', ctx.p3.token, { titulo: 'Cuero vacuno café' }, [{ datos: ctx.PNG, tipo: 'image/png', nombre: 'a.png' }]);
    check('Sin Gemini disponible responde 503 con un mensaje claro', r.status === 503 && /no está disponible/.test(r.data.message), JSON.stringify(r));
}
