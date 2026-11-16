// 8. Perfil
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('8. Perfil');
    r = await api('GET', `/api/perfil/${ctx.p1.id}`, { token: ctx.p1.token });
    check('Ver mi propio perfil', r.status === 200 && r.data.CorreoElectronico === 'prov1@prueba.com');
    r = await api('GET', `/api/perfil/${ctx.p1.id}`, { token: ctx.e1.token });
    check('Ver el perfil (correo, teléfono) de otro usuario → 403', r.status === 403);
    r = await api('GET', `/api/perfil/${ctx.p1.id}`, { token: ctx.admin.token });
    check('Admin puede ver cualquier perfil', r.status === 200);
    r = await api('GET', `/api/perfil/${ctx.p1.id}`);
    check('Perfil sin sesión → 401', r.status === 401);
}
