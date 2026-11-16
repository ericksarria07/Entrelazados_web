// 11. Rutas públicas y errores
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('11. Rutas públicas y errores');
    r = await api('GET', '/api/estadisticas');
    check('Estadísticas públicas', r.status === 200 && r.data.proveedores === 2 && r.data.emprendedores === 3, JSON.stringify(r.data));
    r = await api('POST', '/api/chat/ia', { body: { mensajeUsuario: 'hola' } });
    check('Kan sin sesión → 401 (nadie de fuera gasta la cuota de Gemini)', r.status === 401);
    r = await api('POST', '/api/chat/ia', { token: ctx.e1.token, body: { mensajeUsuario: 'hola' } });
    check('Kan responde con sesión', r.status === 200 && /Kan/.test(r.data.respuesta), JSON.stringify(r));
    r = await api('POST', '/api/chat/ia', { token: ctx.admin.token, body: { mensajeUsuario: 'quiero ver las métricas', rolUsuario: 'emprendedor' } });
    check('Kan usa el rol de la sesión (admin), no el que manda el navegador', r.status === 200 && /Administración/.test(r.data.respuesta), JSON.stringify(r));
}
