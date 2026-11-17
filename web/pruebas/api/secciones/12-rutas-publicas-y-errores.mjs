// 11. Rutas públicas y errores
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { B, api, check, seccion } from '../contexto.mjs';

const APP_API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'app', 'api');
// No se documentan: la documentación misma y la respuesta 404 para lo que no existe
const SIN_DOCUMENTAR = ['/api/docs', '/api/openapi.json', '/api/[...ruta]'];

// Rutas de app/api: /api/ofertas/[id] -> "/api/ofertas/{id} put" por cada método exportado
function rutasDelCodigo(dir = APP_API, base = '/api') {
    const salida = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const ruta = `${base}/${e.name}`;
        const archivo = path.join(dir, e.name, 'route.ts');
        if (fs.existsSync(archivo) && !SIN_DOCUMENTAR.includes(ruta)) {
            const codigo = fs.readFileSync(archivo, 'utf8');
            for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
                if (new RegExp(`export (const|async function) ${m}\\b`).test(codigo)) {
                    salida.push(`${ruta.replace(/\[([^\]]+)\]/g, '{$1}')} ${m.toLowerCase()}`);
                }
            }
        }
        salida.push(...rutasDelCodigo(path.join(dir, e.name), ruta));
    }
    return salida;
}

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
    // historial: los mensajes anteriores para que Kan recuerde (opcional; si no sirve se ignora)
    const historial = Array.from({ length: 14 }, (_, i) => ({ rol: i % 2 ? 'kan' : 'usuario', texto: `mensaje ${i}` }));
    r = await api('POST', '/api/chat/ia', { token: ctx.e2.token, body: { mensajeUsuario: '¿y cuánto cuesta ese?', historial } });
    check('Kan acepta el historial de la conversación (más de 10 se recorta)', r.status === 200 && typeof r.data.respuesta === 'string', JSON.stringify(r));
    r = await api('POST', '/api/chat/ia', { token: ctx.e2.token, body: { mensajeUsuario: '¿y cuánto cuesta ese?', historial: 'no es una lista' } });
    check('Kan ignora un historial que no es una lista', r.status === 200 && typeof r.data.respuesta === 'string', JSON.stringify(r));
    r = await api('POST', '/api/chat/ia', { token: ctx.e2.token, body: { historial: [{ rol: 'kan', texto: 'hola' }, { rol: 'raro', texto: 1 }, null] } });
    check('Kan con historial pero sin mensaje → 400', r.status === 400, JSON.stringify(r));

    // Documentación de la API (Swagger)
    r = await api('GET', '/api/openapi.json');
    check('/api/openapi.json entrega la especificación OpenAPI', r.status === 200 && r.data && r.data.openapi && r.data.paths, String(r.status));
    const documentadas = r.data && r.data.paths
        ? Object.entries(r.data.paths).flatMap(([ruta, ops]) => Object.keys(ops).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map((m) => `${ruta} ${m}`))
        : [];
    const codigo = rutasDelCodigo();
    const faltan = codigo.filter((x) => !documentadas.includes(x));
    const sobran = documentadas.filter((x) => x.startsWith('/api/') && !codigo.includes(x));
    check('Cada ruta de app/api está documentada en docs/openapi.yaml (y no sobra ninguna)', faltan.length === 0 && sobran.length === 0, JSON.stringify({ faltan, sobran }));
    const docs = await fetch(B + '/api/docs');
    check('/api/docs muestra Swagger UI', docs.status === 200 && /swagger-ui/.test(await docs.text()));
}
