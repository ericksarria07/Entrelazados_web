// Prueba la aplicación Express completa (app.js) sin MySQL: la base de datos y los
// servicios se reemplazan por objetos falsos. Levanta el servidor en un puerto libre
// solo durante la prueba.
const { silenciarConsola } = require('./ayudas');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../../entrelazados-api/app');

// Base de datos que siempre falla: sirve para ver cómo responde cada ruta sin datos
const dbCaida = { query: async () => { throw new Error('sin base de datos en esta prueba'); } };

let servidor, URL_BASE;

before(async () => {
    const app = crearApp({
        config: { origenesCors: [], jwtSecreto: 'secreto-app-test', duracionSesion: '1h', rondasBcrypt: 4, urlPublica: '' },
        db: dbCaida,
        correo: { configurado: false },
        servicios: { ofertas: {}, tratos: {}, cierreSubastas: {}, kan: {} },
        verificarCorreo: false
    });
    servidor = await new Promise((listo) => { const s = app.listen(0, () => listo(s)); });
    URL_BASE = `http://localhost:${servidor.address().port}`;
});

after(() => servidor && servidor.close());

const pedir = (ruta, opciones) => fetch(URL_BASE + ruta, opciones);

test('GET /api/ping responde que el servidor está en línea', async () => {
    const r = await pedir('/api/ping');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, 'ok');
});

test('GET /api/openapi.json entrega la especificación', async () => {
    const r = await pedir('/api/openapi.json');
    assert.equal(r.status, 200);
    const especificacion = await r.json();
    assert.equal(especificacion.openapi, '3.1.0');
    assert.equal(especificacion.info.title, 'API de EntreLazados');
    assert.ok(especificacion.paths['/api/login'].post);
});

test('GET /api/docs/ muestra la página de Swagger UI', async () => {
    const r = await pedir('/api/docs/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const html = await r.text();
    assert.match(html, /swagger-ui/);
    assert.match(html, /API de EntreLazados/);
});

test('/api/docs (sin barra final) también llega a Swagger UI', async () => {
    const r = await pedir('/api/docs');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /swagger-ui/);
});

test('la documentación no gasta el límite de peticiones de la API; las rutas sí lo usan', async () => {
    const docs = await pedir('/api/openapi.json');
    assert.equal(docs.headers.get('ratelimit'), null);
    const ping = await pedir('/api/ping');
    assert.ok(ping.headers.get('ratelimit'), 'las rutas de la API llevan el encabezado RateLimit');
});

test('una ruta de la API que no existe responde 404 en JSON', async () => {
    const r = await pedir('/api/no-existe');
    assert.equal(r.status, 404);
    assert.equal((await r.json()).message, 'Ruta no encontrada.');
});

test('una ruta con sesión responde 401 si no se envía el token', async () => {
    for (const ruta of ['/api/tratos', '/api/dashboard', '/api/chat/contactos', '/api/admin/metricas', '/api/notificaciones', '/api/reportes']) {
        const r = await pedir(ruta);
        assert.equal(r.status, 401, ruta);
    }
});

test('un JSON mal escrito responde 400 (no 500)', async () => {
    const r = await pedir('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ "email": ' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).message, 'Formato de datos inválido.');
});

test('si la base de datos falla, las consultas públicas devuelven un valor vacío', async () => {
    await silenciarConsola(async () => {
        const categorias = await pedir('/api/categorias');
        assert.equal(categorias.status, 500);
        assert.deepEqual(await categorias.json(), []);
        const estadisticas = await pedir('/api/estadisticas');
        assert.deepEqual(await estadisticas.json(), { proveedores: 0, emprendedores: 0, subastas: 0 });
    });
});

test('se publican las páginas de public/ (la raíz muestra preview.html)', async () => {
    const raiz = await pedir('/');
    assert.equal(raiz.status, 200);
    assert.match(raiz.headers.get('content-type'), /text\/html/);
    assert.equal((await pedir('/mercado.html')).status, 200);
});

test('el código del servidor y el .env no se pueden descargar', async () => {
    for (const ruta of ['/.env', '/config.js', '/app.js', '/docs/openapi.yaml', '/../package.json']) {
        const r = await pedir(ruta);
        assert.notEqual(r.status, 200, ruta);
    }
});
