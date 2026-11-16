// 5. Subastas y pujas
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('5. Subastas y pujas');
    const subastas = (await api('GET', '/api/subastas')).data;
    check('Cada oferta creó su subasta', subastas.length === 2);
    ctx.subP1 = subastas.find(s => s.ProveedorID === ctx.p1.id);
    check('…ligada a su publicación y a su categoría (OfertaID, CategoriaID)', ctx.subP1 && ctx.subP1.OfertaID === ctx.ofP1.OfertaID && ctx.subP1.CategoriaID === 1 && ctx.subP1.NombreCategoria === 'Cuero Bovino / Vacuno', JSON.stringify(ctx.subP1));
    check('…con el número de pujas y sin foto (la publicación no tiene)', ctx.subP1 && ctx.subP1.TotalPujas === 0 && ctx.subP1.Foto === null, JSON.stringify(ctx.subP1));
    r = await api('POST', '/api/pujas', { body: { subastaId: ctx.subP1.SubastaID, montoPuja: 500 } });
    check('Pujar sin sesión → 401', r.status === 401);
    r = await api('POST', '/api/pujas', { token: ctx.p2.token, body: { subastaId: ctx.subP1.SubastaID, montoPuja: 500 } });
    check('Proveedor intenta pujar → 403', r.status === 403);
    r = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: ctx.subP1.SubastaID, montoPuja: 300 } });
    check('Puja menor al precio actual → 409', r.status === 409, JSON.stringify(r));
    r = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: ctx.subP1.SubastaID, montoPuja: 500, emprendedorId: ctx.e2.id } });
    check('Puja válida de 500 (con emprendedorId falso)', r.status === 200, JSON.stringify(r));
    const puja = (await q(`SELECT emprendedor_id FROM pujas WHERE subasta_id = $1`, [ctx.subP1.SubastaID]))[0];
    check('La puja quedó a nombre del emprendedor 1', puja.EmprendedorID === ctx.e1.id);
    r = await api('POST', '/api/pujas', { token: ctx.e2.token, body: { subastaId: ctx.subP1.SubastaID, montoPuja: 500 } });
    check('Puja igual al precio actual → 409', r.status === 409);
    const montos = [510, 530, 590, 520, 560, 580, 540, 570];
    const simultaneas = await Promise.all(montos.map((m, i) => api('POST', '/api/pujas', { token: (i % 2 ? ctx.e1 : ctx.e2).token, body: { subastaId: ctx.subP1.SubastaID, montoPuja: m } })));
    const precioFinal = Number((await q(`SELECT precio_actual FROM subastas WHERE subasta_id = $1`, [ctx.subP1.SubastaID]))[0].PrecioActual);
    check(`8 pujas simultáneas: el precio final es la mayor (590)`, precioFinal === 590, `precio=${precioFinal}`);
    const aceptadas = simultaneas.filter(x => x.status === 200).length;
    const filasPujas = (await q(`SELECT count(*)::int n FROM pujas WHERE subasta_id = $1`, [ctx.subP1.SubastaID]))[0].n;
    check('Historial de pujas coincide con las aceptadas', filasPujas === aceptadas + 1, `aceptadas=${aceptadas} filas=${filasPujas}`);
    await q(`UPDATE subastas SET fecha_fin = NOW() - interval '1 hour' WHERE subasta_id = $1`, [ctx.subP1.SubastaID]);
    r = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: ctx.subP1.SubastaID, montoPuja: 9999 } });
    check('Pujar en subasta vencida → 409 "ya finalizó"', r.status === 409 && /finaliz/.test(r.data.message), JSON.stringify(r));
    r = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: 999999, montoPuja: 10 } });
    check('Subasta inexistente → 404', r.status === 404);
}
