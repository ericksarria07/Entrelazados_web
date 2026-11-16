// 29. Mapa de proveedores
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('29. Mapa de proveedores');
    r = await api('GET', '/api/mapa/proveedores');
    check('Sin sesión → 401', r.status === 401);
    // p3 escribió " leon " y p1 un lugar que no está en Nicaragua
    const deptoNuevo = async (nombre) => {
        await q(`INSERT INTO departamentos (nombre_departamento) VALUES ($1) ON CONFLICT DO NOTHING`, [nombre]);
        return (await q(`SELECT departamento_id FROM departamentos WHERE nombre_departamento = $1`, [nombre]))[0].DepartamentoID;
    };
    await q(`UPDATE perfiles_usuarios SET departamento_id = $1 WHERE usuario_id = $2`, [await deptoNuevo(' leon '), ctx.p3.id]);
    await q(`UPDATE perfiles_usuarios SET departamento_id = $1 WHERE usuario_id = $2`, [await deptoNuevo('Tegucigalpa'), ctx.p1.id]);
    r = await api('GET', '/api/mapa/proveedores', { token: ctx.e1.token });
    const mapaTodo = r.data;
    const deptoDe = (id) => (mapaTodo.departamentos.find(d => d.proveedores.some(p => p.id === id)) || {}).departamento;
    check('Agrupa a los proveedores por departamento, con coordenadas', r.status === 200 && mapaTodo.departamentos.every(d => typeof d.lat === 'number' && typeof d.lng === 'number'), JSON.stringify(mapaTodo).slice(0, 300));
    check('…reconoce " leon " como León y pone a p2 en Managua', deptoDe(ctx.p3.id) === 'León' && deptoDe(ctx.p2.id) === 'Managua', JSON.stringify(mapaTodo.departamentos.map(d => [d.departamento, d.proveedores.map(p => p.id)])));
    check('…y quien escribió un lugar desconocido va en sinUbicacion', mapaTodo.sinUbicacion.some(p => p.id === ctx.p1.id && p.departamentoEscrito === 'Tegucigalpa'), JSON.stringify(mapaTodo.sinUbicacion));
    check('…sin emprendedores', !JSON.stringify(mapaTodo).includes(`"id":${ctx.e1.id},`));
    const provP3 = mapaTodo.departamentos.flatMap(d => d.proveedores).find(p => p.id === ctx.p3.id);
    check('…cuenta sus publicaciones y categorías, sin correo ni teléfono', provP3 && provP3.ofertas >= 1 && provP3.categorias.length >= 1 && !('correo' in provP3) && !('telefono' in provP3), JSON.stringify(provP3));
    check('…y dice dónde está quien mira (Managua)', mapaTodo.miUbicacion && mapaTodo.miUbicacion.nombre === 'Managua');
    r = await api('GET', '/api/mapa/proveedores?categoria=1', { token: ctx.e1.token });
    const enCat1 = r.data.departamentos.flatMap(d => d.proveedores).concat(r.data.sinUbicacion);
    check('Con ?categoria= solo salen quienes venden esa categoría', r.status === 200 && enCat1.some(p => p.id === ctx.p3.id) && enCat1.every(p => p.ofertas > 0 && p.categorias.length === 1), JSON.stringify(enCat1));
}
