// 9. Panel de administrador
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('9. Panel de administrador');
    r = await api('GET', '/api/admin/metricas', { token: ctx.p1.token });
    check('Proveedor entra a métricas de admin → 403', r.status === 403);
    r = await api('GET', '/api/admin/metricas', { token: ctx.admin.token });
    check('Admin ve métricas', r.status === 200 && r.data.totalUsuarios === 6, JSON.stringify(r.data));
    r = await api('GET', '/api/admin/usuarios', { token: ctx.admin.token });
    check('Admin lista usuarios (corregido FechaCreacion → FechaRegistro)', r.status === 200 && r.data.length === 6 && r.data[0].FechaCreacion, JSON.stringify(r).slice(0, 200));
    r = await api('POST', '/api/admin/categorias', { token: ctx.admin.token, body: { nombreCategoria: 'Cordones y Agujetas', descripcion: 'Cordones de algodón y cuero' } });
    check('Admin crea categoría con descripción', r.status === 200, JSON.stringify(r));
    r = await api('PUT', `/api/admin/usuarios/${ctx.e1.id}/estado`, { token: ctx.admin.token, body: { nuevoEstado: 'Suspendido' } });
    check('Admin suspende al emprendedor 1', r.status === 200);
    r = await api('GET', '/api/chat/contactos', { token: ctx.e1.token });
    check('…su token deja de funcionar al instante (403)', r.status === 403, JSON.stringify(r));
    r = await ctx.login('emp1@prueba.com', 'Clave123');
    check('…y no puede iniciar sesión (403)', r.status === 403);
    await api('PUT', `/api/admin/usuarios/${ctx.e1.id}/estado`, { token: ctx.admin.token, body: { nuevoEstado: 'Activo' } });
    r = await api('GET', '/api/chat/contactos', { token: ctx.e1.token });
    check('Al reactivarlo vuelve a funcionar', r.status === 200);
    r = await api('PUT', `/api/admin/usuarios/${ctx.e1.id}/estado`, { token: ctx.admin.token, body: { nuevoEstado: 'Hackeado' } });
    check('Estado inválido → 400', r.status === 400);
    await q(`UPDATE usuarios SET tipo_rol = $1 WHERE usuario_id = $2`, ['Proveedor', ctx.admin.id]);
    r = await api('GET', '/api/admin/metricas', { token: ctx.admin.token });
    check('Si le quitan el rol de admin, su token ya no da acceso (403)', r.status === 403);
    await q(`UPDATE usuarios SET tipo_rol = $1 WHERE usuario_id = $2`, ['Administrador', ctx.admin.id]);
}
