// 33. Encabezados de seguridad y CSP (next.config.ts)
// Cada respuesta lleva la Content Security Policy y los encabezados que frenan clickjacking,
// adivinar tipos de archivo y filtrar rutas en el Referer. /api/docs tiene su propia CSP
// porque Swagger UI se carga desde unpkg.
import { B, check, seccion } from '../contexto.mjs';

// La CSP como objeto: { "script-src": ["'self'", ...], ... }
function leerCSP(valor) {
    const directivas = {};
    for (const parte of (valor ?? '').split(';')) {
        const [nombre, ...valores] = parte.trim().split(/\s+/);
        if (nombre) directivas[nombre] = valores;
    }
    return directivas;
}

export default async function correr() {
    seccion('33. Encabezados de seguridad y CSP');

    for (const ruta of ['/', '/login', '/api/ping']) {
        const r = await fetch(B + ruta, { redirect: 'manual' });
        const h = r.headers;
        const csp = leerCSP(h.get('content-security-policy'));
        check(`${ruta}: trae Content-Security-Policy`, Boolean(h.get('content-security-policy')));
        check(`${ruta}: …scripts solo del propio sitio (sin dominios ajenos)`,
            csp['script-src']?.[0] === "'self'" && !csp['script-src'].some((v) => v.startsWith('http')), JSON.stringify(csp['script-src']));
        check(`${ruta}: …nadie lo mete en un iframe (frame-ancestors 'none')`, csp['frame-ancestors']?.join(' ') === "'none'");
        check(`${ruta}: …sin plugins (object-src 'none') y base-uri 'self'`,
            csp['object-src']?.join(' ') === "'none'" && csp['base-uri']?.join(' ') === "'self'");
        check(`${ruta}: …conexiones solo al sitio y a Ably`,
            csp['connect-src']?.every((v) => v === "'self'" || /^(https|wss):\/\/\*\.ably(-realtime)?\.(net|com)$/.test(v)), JSON.stringify(csp['connect-src']));
        check(`${ruta}: X-Content-Type-Options: nosniff`, h.get('x-content-type-options') === 'nosniff');
        check(`${ruta}: X-Frame-Options: DENY`, h.get('x-frame-options') === 'DENY');
        check(`${ruta}: Referrer-Policy: strict-origin-when-cross-origin`, h.get('referrer-policy') === 'strict-origin-when-cross-origin');
        check(`${ruta}: Permissions-Policy apaga cámara, micrófono y ubicación`,
            /camera=\(\)/.test(h.get('permissions-policy') ?? '') && /microphone=\(\)/.test(h.get('permissions-policy') ?? '') && /geolocation=\(\)/.test(h.get('permissions-policy') ?? ''),
            h.get('permissions-policy'));
    }

    const r = await fetch(B + '/api/docs');
    const csp = leerCSP(r.headers.get('content-security-policy'));
    check('/api/docs: su CSP permite Swagger UI desde unpkg', csp['script-src']?.includes('https://unpkg.com') && csp['style-src']?.includes('https://unpkg.com'), JSON.stringify(csp));
    check('/api/docs: …y sigue sin dejarse meter en un iframe', csp['frame-ancestors']?.join(' ') === "'none'" && r.headers.get('x-frame-options') === 'DENY');
}
