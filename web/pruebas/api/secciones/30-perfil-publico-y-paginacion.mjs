// 31. Perfil público y paginación
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q, B } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('31. Perfil público y paginación');
    // Perfil público: sin sesión, sin datos de contacto
    r = await api('GET', `/api/usuarios/${ctx.p3.id}/publico`);
    const pub = r.data;
    const cuentaP3 = (await q(`SELECT (SELECT count(*)::int FROM ofertas WHERE proveedor_id = $1) o,
        (SELECT count(*)::int FROM subastas WHERE proveedor_id = $2 AND estado = 'Activa' AND fecha_fin > NOW()) s`, [ctx.p3.id, ctx.p3.id]))[0];
    check('Perfil público de un proveedor sin iniciar sesión', r.status === 200 && pub.id === ctx.p3.id && pub.rol === 'Proveedor' && pub.nombre === 'Curtiembre Tres', JSON.stringify(pub));
    check('…cuenta sus publicaciones y subastas activas', pub.estadisticas.publicaciones === cuentaP3.o && pub.estadisticas.subastasActivas === cuentaP3.s, JSON.stringify([pub.estadisticas, cuentaP3]));
    check('…y nunca trae correo, teléfono, dirección ni RUC', !/@prueba\.com/.test(JSON.stringify(pub)) && !['correo', 'telefono', 'TelefonoWhatsApp', 'NumeroRUC', 'DireccionExacta', 'CorreoElectronico'].some(k => k in pub), JSON.stringify(pub));
    check('…ni datos de emprendedor (marca, especialidad)', pub.marca === null && pub.especialidad === null);

    // El usuario con más calificaciones: su reputación y sus reseñas paginadas
    const masCalificado = (await q(`SELECT c.calificado_id id, count(*)::int n, AVG(c.puntuacion) prom FROM calificaciones c
        JOIN usuarios u ON u.usuario_id = c.calificado_id AND u.estado_cuenta = 'Activo' AND LOWER(u.tipo_rol) IN ('proveedor', 'emprendedor')
        GROUP BY c.calificado_id ORDER BY n DESC, c.calificado_id LIMIT 1`))[0];
    check('(hay calificaciones para probar)', !!masCalificado, 'sin calificaciones en la base');
    if (masCalificado) {
        r = await api('GET', `/api/usuarios/${masCalificado.id}/publico`);
        const rep = r.data.reputacion;
        const sumaDistribucion = Object.values(rep.distribucion).reduce((a, b) => a + b, 0);
        check('La reputación pública: total, promedio y cuántas de cada estrella', r.status === 200 && rep.total === masCalificado.n && sumaDistribucion === masCalificado.n
            && rep.promedio === Math.round(Number(masCalificado.prom) * 10) / 10 && Object.keys(rep.distribucion).length === 5, JSON.stringify([rep, masCalificado]));
        r = await api('GET', `/api/usuarios/${masCalificado.id}/resenas`);
        check('Reseñas sin ?pagina: la página 1, de a 5', r.status === 200 && r.data.pagina === 1 && r.data.porPagina === 5 && r.data.total === masCalificado.n && r.data.datos.length === Math.min(5, masCalificado.n), JSON.stringify(r.data));
        check('…con autor, estrellas y fecha', r.data.datos.every(c => c.autor && c.puntuacion >= 1 && c.puntuacion <= 5 && c.fecha));
        r = await api('GET', `/api/usuarios/${masCalificado.id}/resenas?pagina=1&porPagina=1`);
        check('Reseñas de a una: tantas páginas como reseñas', r.data.datos.length === 1 && r.data.paginas === masCalificado.n, JSON.stringify(r.data));
        r = await api('GET', `/api/usuarios/${masCalificado.id}/resenas?porPagina=999`);
        check('…porPagina se limita a 20', r.data.porPagina === 20);
    }

    r = await api('GET', `/api/usuarios/${ctx.e1.id}/publico`);
    check('Un emprendedor también tiene perfil público (sin publicaciones)', r.status === 200 && r.data.rol === 'Emprendedor' && r.data.estadisticas.publicaciones === 0 && r.data.nombreComercial === null, JSON.stringify(r.data));
    r = await api('GET', `/api/usuarios/${ctx.admin.id}/publico`);
    check('El administrador no tiene perfil público → 404', r.status === 404);
    r = await api('GET', '/api/usuarios/999999/publico');
    check('Un usuario que no existe → 404', r.status === 404);
    r = await api('GET', '/api/usuarios/abc/resenas');
    check('…o un número inválido → 404', r.status === 404);
    await q(`UPDATE usuarios SET estado_cuenta = 'Suspendido' WHERE usuario_id = $1`, [ctx.e2.id]);
    r = await api('GET', `/api/usuarios/${ctx.e2.id}/publico`);
    const resenasSuspendido = await api('GET', `/api/usuarios/${ctx.e2.id}/resenas`);
    await q(`UPDATE usuarios SET estado_cuenta = 'Activo' WHERE usuario_id = $1`, [ctx.e2.id]);
    check('Una cuenta suspendida no muestra perfil ni reseñas → 404', r.status === 404 && resenasSuspendido.status === 404);
    // La página (React, Fase 2) se arma en el servidor; la URL vieja .html redirige y conserva ?id=
    r = await fetch(B + `/perfil-publico.html?id=${ctx.p3.id}`);
    check('/perfil-publico.html?id= redirige a /perfil-publico y el servidor arma el perfil', r.status === 200 && r.url.endsWith(`/perfil-publico?id=${ctx.p3.id}`) && /Calificaciones y reseñas/.test(await r.text()), r.url);

    // Subastas de un proveedor
    r = await api('GET', `/api/subastas?proveedorId=${ctx.p3.id}&pagina=1&porPagina=50`);
    check('GET /api/subastas?proveedorId= trae solo las de ese proveedor', r.status === 200 && r.data.total === cuentaP3.s && r.data.datos.every(x => x.ProveedorID === ctx.p3.id), JSON.stringify(r.data).slice(0, 300));

    // Tratos paginados
    const tratosE3 = (await q(`SELECT count(*)::int n FROM tratos_cerrados WHERE proveedor_id = $1 OR emprendedor_id = $2`, [ctx.e3.id, ctx.e3.id]))[0].n;
    r = await api('GET', '/api/tratos?pagina=1&porPagina=1', { token: ctx.e3.token });
    check('/api/tratos?pagina= responde paginado', r.status === 200 && r.data.total === tratosE3 && r.data.datos.length === Math.min(1, tratosE3) && r.data.paginas === Math.max(1, tratosE3), JSON.stringify(r.data));
    r = await api('GET', '/api/tratos?origen=Subasta&pagina=1&porPagina=20', { token: ctx.e3.token });
    check('…?origen=Subasta deja solo los de subastas', r.status === 200 && r.data.datos.every(t => t.origen === 'Subasta'));
    r = await api('GET', '/api/tratos', { token: ctx.e3.token });
    check('…y sin ?pagina sigue respondiendo la lista', Array.isArray(r.data) && r.data.length === tratosE3);

    // Favoritos paginados: e1 guarda una segunda publicación (la más reciente va primero)
    const otraOferta = (await q(`SELECT oferta_id FROM ofertas WHERE proveedor_id <> $1 AND oferta_id <> $2 ORDER BY oferta_id DESC LIMIT 1`, [ctx.e1.id, ctx.ofCafe]))[0].OfertaID;
    await q(`UPDATE favoritos SET fecha_guardado = NOW() - interval '1 minute' WHERE usuario_id = $1`, [ctx.e1.id]);
    await api('POST', `/api/favoritos/${otraOferta}`, { token: ctx.e1.token });
    r = await api('GET', '/api/favoritos?pagina=1&porPagina=1', { token: ctx.e1.token });
    check('/api/favoritos?pagina= responde paginado, la más reciente primero', r.status === 200 && r.data.total === 2 && r.data.paginas === 2 && r.data.datos.length === 1 && r.data.datos[0].OfertaID === otraOferta, JSON.stringify(r.data).slice(0, 300));
    r = await api('GET', '/api/favoritos?pagina=2&porPagina=1', { token: ctx.e1.token });
    check('…la página 2 trae la otra', r.data.datos.length === 1 && r.data.datos[0].OfertaID === ctx.ofCafe);
    r = await api('GET', '/api/favoritos', { token: ctx.e1.token });
    check('…y sin ?pagina sigue respondiendo la lista', Array.isArray(r.data) && r.data.length === 2);

    // El Mercado pasó a React (Fase 2): la URL vieja redirige (308) y conserva el query string
    r = await fetch(B + '/mercado.html?oferta=5#tab-auctions', { redirect: 'manual' });
    check('/mercado.html redirige (308) a /mercado conservando ?oferta=', r.status === 308 && r.headers.get('location')?.endsWith('/mercado?oferta=5'), `${r.status} ${r.headers.get('location')}`);
}
