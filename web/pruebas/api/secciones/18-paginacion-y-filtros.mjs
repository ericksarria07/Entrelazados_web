// 19. Paginación y filtros
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('19. Paginación y filtros');
    const totalOfertas = (await q(`SELECT count(*)::int n FROM ofertas`))[0].n;
    const pag1 = (await api('GET', '/api/ofertas?pagina=1&porPagina=2')).data;
    const pag2 = (await api('GET', '/api/ofertas?pagina=2&porPagina=2')).data;
    check('Ofertas por páginas: total, páginas y 2 por página', pag1.total === totalOfertas && pag1.paginas === Math.ceil(totalOfertas / 2) && pag1.datos.length === Math.min(2, totalOfertas) && pag1.pagina === 1, JSON.stringify({ ...pag1, datos: pag1.datos.length }));
    check('…la página 2 no repite ofertas de la 1', pag2.datos.every(o => !pag1.datos.some(x => x.OfertaID === o.OfertaID)));
    r = await api('GET', '/api/ofertas?pagina=999&porPagina=2');
    check('Página que no existe → lista vacía con el total', r.status === 200 && r.data.datos.length === 0 && r.data.total === totalOfertas);
    r = await api('GET', '/api/ofertas?pagina=abc&porPagina=1000');
    check('Valores raros se corrigen (página 1, máximo 50 por página)', r.status === 200 && r.data.pagina === 1 && r.data.porPagina === 50);
    r = await api('GET', '/api/ofertas?pagina=1&q=BADANA');
    check('Buscar por texto (sin importar mayúsculas)', r.data.total === 1 && r.data.datos[0].OfertaID === ctx.ofEditar, JSON.stringify(r.data));
    r = await api('GET', '/api/ofertas?pagina=1&q=' + encodeURIComponent('%'));
    check('Un "%" en la búsqueda se toma literal (no trae todo)', r.data.total === 0, JSON.stringify(r.data.total));
    r = await api('GET', '/api/ofertas?pagina=1&porPagina=50&categoria=2');
    check('Filtrar por categoría', r.data.total >= 1 && r.data.datos.every(o => o.CategoriaID === 2));
    r = await api('GET', '/api/ofertas?pagina=1&porPagina=50&maxKm=4');
    check('Filtrar por distancia máxima', r.data.datos.every(o => o.DistanciaSimuladaKm <= 4) && r.data.total === (await q(`SELECT count(*)::int n FROM ofertas WHERE distancia_simulada_km <= 4`))[0].n);
    r = await api('GET', `/api/ofertas?proveedorId=${ctx.p3.id}`);
    check('Sin ?pagina devuelve la lista (filtrada por proveedor) con su nombre', Array.isArray(r.data) && r.data.length === 1 && r.data[0].NombreProveedor === 'Curtiembre Tres' && r.data[0].TotalCalificaciones === 0 && r.data[0].CalificacionProveedor === null, JSON.stringify(r.data));
    const subastasAbiertas = (await q(`SELECT count(*)::int n FROM subastas WHERE estado = 'Activa' AND fecha_fin > NOW()`))[0].n;
    r = await api('GET', '/api/subastas?pagina=1&porPagina=1');
    check('Subastas por páginas', r.data.total === subastasAbiertas && r.data.datos.length === Math.min(1, subastasAbiertas), JSON.stringify(r.data));
    r = await api('GET', '/api/subastas?pagina=1&q=badana');
    check('Buscar subastas por texto', r.data.total === 1 && r.data.datos[0].SubastaID === ctx.subEditar, JSON.stringify(r.data));
    const totalUsuarios = (await q(`SELECT count(*)::int n FROM usuarios`))[0].n;
    r = await api('GET', '/api/admin/usuarios?pagina=1&porPagina=2', { token: ctx.admin.token });
    check('Admin: usuarios por páginas', r.data.total === totalUsuarios && r.data.datos.length === 2, JSON.stringify(r.data && r.data.total));
    r = await api('GET', '/api/admin/usuarios?pagina=1&buscar=prov3', { token: ctx.admin.token });
    check('Admin: buscar usuarios por correo', r.data.total === 1 && r.data.datos[0].UsuarioID === ctx.p3.id);
    r = await api('GET', '/api/admin/usuarios?pagina=1', { token: ctx.p3.token });
    check('…un proveedor no puede listar usuarios → 403', r.status === 403);
}
