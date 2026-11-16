// 3. Tokens
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import jwt from 'jsonwebtoken';
import { api, check, seccion } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('3. Tokens');
    const falso = jwt.sign({ id: ctx.admin.id, rol: 'Administrador' }, 'secreto-inventado');
    r = await api('GET', '/api/admin/metricas', { token: falso });
    check('Token firmado con otro secreto → 401', r.status === 401);
    r = await api('GET', '/api/admin/metricas', { headers: { 'x-user-id': String(ctx.admin.id) } });
    check('Truco viejo x-user-id del admin → 401', r.status === 401);
    const payloadVencido = JSON.parse(Buffer.from(ctx.p1.token.split('.')[1], 'base64url'));
    check('El token expira (tiene campo exp de 8 h)', payloadVencido.exp - payloadVencido.iat === 8 * 3600);
}
