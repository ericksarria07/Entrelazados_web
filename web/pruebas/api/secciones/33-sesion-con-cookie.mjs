// 32. Sesión en cookie httpOnly y protección CSRF (ROADMAP 2.1)
// POST /api/login guarda la sesión en la cookie "sesion"; GET /api/sesion dice quién entró;
// POST /api/logout la borra; proxy.ts rechaza escrituras que vienen de otro sitio.
import { api, B, check, cookieSesion, hayTiempoReal, seccion } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('32. Sesión en cookie httpOnly y protección CSRF');

    r = await ctx.login('prov1@prueba.com', 'Clave123');
    const c = r.cookie;
    check('Login guarda la sesión en la cookie "sesion"', r.status === 200 && c && c.valor.split('.').length === 3, JSON.stringify(r.setCookie));
    check('…con HttpOnly, SameSite=Lax y Path=/', c && c.atributos.includes('httponly') && c.atributos.includes('samesite=lax') && c.atributos.includes('path=/'), c?.linea);
    check('…que dura 8 horas (Max-Age=28800)', c && c.atributos.includes('max-age=28800'), c?.linea);
    check('…y el token no va en el cuerpo de la respuesta', r.status === 200 && !r.tokenEnCuerpo);
    check('El cuerpo trae cuándo empieza y vence la sesión', r.data?.sesion?.vence - r.data?.sesion?.inicio === 28800, JSON.stringify(r.data?.sesion));

    const cookie = `sesion=${c?.valor}`;
    r = await api('GET', '/api/sesion', { cookie });
    check('GET /api/sesion con la cookie → los datos de la cuenta', r.status === 200 && r.data.id === ctx.p1.id && r.data.email === 'prov1@prueba.com' && r.data.esAdmin === false, JSON.stringify(r.data));
    r = await api('GET', '/api/sesion', { token: ctx.admin.token });
    check('…también con Authorization: Bearer (pruebas y Swagger)', r.status === 200 && r.data.esAdmin === true, JSON.stringify(r.data));
    r = await api('GET', '/api/sesion');
    check('GET /api/sesion sin sesión → 401', r.status === 401);
    r = await api('GET', '/api/sesion', { cookie: 'sesion=no.es.valido' });
    check('Cookie inválida → 401', r.status === 401);
    r = await api('GET', '/api/sesion', { cookie, headers: { Authorization: 'Bearer ' } });
    check('"Bearer" vacío no tapa la cookie', r.status === 200, String(r.status));
    r = await api('GET', '/api/chat/contactos', { cookie });
    check('Una ruta con sesión funciona solo con la cookie', r.status === 200, String(r.status));

    if (hayTiempoReal) {
        r = await api('GET', '/api/tiempo-real/token', { cookie });
        check('Tiempo real con la cookie → incluye el canal propio', r.status === 200 && Boolean(r.data?.canales?.usuario), JSON.stringify(r.data?.canales));
    }

    // Protección CSRF (proxy.ts)
    r = await api('POST', '/api/chat/enviar', { cookie, headers: { Origin: 'https://sitio-malo.example' }, body: { destinatarioId: ctx.e1.id, texto: 'csrf' } });
    check('Escritura con Origin de otro sitio → 403', r.status === 403, String(r.status));
    r = await api('GET', '/api/sesion', { cookie, headers: { Origin: 'https://sitio-malo.example' } });
    check('…las lecturas no se bloquean', r.status === 200, String(r.status));
    r = await api('POST', '/api/logout', { headers: { Origin: B } });
    check('Escritura con el Origin del propio sitio pasa', r.status === 200, String(r.status));

    // Cerrar sesión
    const salida = cookieSesion(r.setCookie);
    check('POST /api/logout borra la cookie (vacía, Max-Age=0)', salida && salida.valor === '' && salida.atributos.includes('max-age=0'), salida?.linea);
}
