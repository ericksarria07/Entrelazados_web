// Comprueba que la documentación (docs/openapi.yaml) y el código dicen lo mismo:
// cada ruta de rutas/*.js está documentada y no se documenta ninguna ruta que no exista.
// Si esta prueba falla después de agregar una ruta, falta describirla en openapi.yaml.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { leerEspecificacion } = require('../../entrelazados-api/rutas/documentacion');

const API = path.join(__dirname, '..', '..', 'entrelazados-api');
const METODOS = ['get', 'post', 'put', 'patch', 'delete'];

// Lee app.js y cada archivo de rutas/ para armar la lista "MÉTODO /ruta" del código.
// Ejemplo: app.use('/api/ofertas', require('./rutas/ofertas')...) + router.put('/:id')
//          → "PUT /api/ofertas/{id}"
function rutasDelCodigo() {
    const app = fs.readFileSync(path.join(API, 'app.js'), 'utf8');
    const montajes = [...app.matchAll(/app\.use\('([^']+)',\s*require\('\.\/rutas\/(\w+)'\)/g)]
        .map(([, prefijo, archivo]) => ({ prefijo, archivo }))
        .filter(m => m.archivo !== 'documentacion');   // /api/docs y /api/openapi.json son la documentación misma
    assert.ok(montajes.length >= 10, 'se encontraron los routers montados en app.js');

    const rutas = new Set();
    for (const { prefijo, archivo } of montajes) {
        const codigo = fs.readFileSync(path.join(API, 'rutas', archivo + '.js'), 'utf8');
        for (const [, metodo, ruta] of codigo.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
            let completa = (prefijo + ruta).replace(/\/{2,}/g, '/');
            if (completa.length > 1) completa = completa.replace(/\/$/, '');
            completa = completa.replace(/:(\w+)/g, '{$1}');
            rutas.add(`${metodo.toUpperCase()} ${completa}`);
        }
    }
    return rutas;
}

function rutasDocumentadas(especificacion) {
    const rutas = new Set();
    for (const [ruta, item] of Object.entries(especificacion.paths)) {
        for (const metodo of METODOS) if (item[metodo]) rutas.add(`${metodo.toUpperCase()} ${ruta}`);
    }
    return rutas;
}

const especificacion = leerEspecificacion();

test('todas las rutas del código están documentadas en openapi.yaml', () => {
    const documentadas = rutasDocumentadas(especificacion);
    const faltan = [...rutasDelCodigo()].filter(r => !documentadas.has(r));
    assert.deepEqual(faltan, [], 'Agrega estas rutas a entrelazados-api/docs/openapi.yaml');
});

test('openapi.yaml no documenta rutas que ya no existen', () => {
    const delCodigo = rutasDelCodigo();
    const sobran = [...rutasDocumentadas(especificacion)].filter(r => !delCodigo.has(r));
    assert.deepEqual(sobran, [], 'Estas rutas están en openapi.yaml pero no en el código');
});

test('la API tiene 37 rutas documentadas', () => {
    assert.equal(rutasDocumentadas(especificacion).size, 37);
});

test('cada ruta documentada tiene resumen, grupo y respuestas', () => {
    const grupos = new Set(especificacion.tags.map(t => t.name));
    for (const [ruta, item] of Object.entries(especificacion.paths)) {
        for (const metodo of METODOS) {
            const op = item[metodo];
            if (!op) continue;
            const nombre = `${metodo.toUpperCase()} ${ruta}`;
            assert.ok(op.summary, `${nombre}: falta summary`);
            assert.ok(op.tags && op.tags.length === 1 && grupos.has(op.tags[0]), `${nombre}: grupo (tag) no declarado`);
            assert.ok(op.responses && Object.keys(op.responses).length > 0, `${nombre}: sin respuestas`);
        }
    }
});

test('los parámetros {id} de la ruta están declarados', () => {
    for (const [ruta, item] of Object.entries(especificacion.paths)) {
        const variables = [...ruta.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
        if (variables.length === 0) continue;
        const declarados = (item.parameters || []).map(p => (p.$ref ? p.$ref.split('/').pop().toLowerCase() : p.name));
        for (const v of variables) assert.ok(declarados.includes(v), `${ruta}: falta declarar {${v}}`);
    }
});

test('todas las referencias ($ref) apuntan a algo que existe', () => {
    const rotas = [];
    (function recorrer(nodo, donde) {
        if (Array.isArray(nodo)) return nodo.forEach((x, i) => recorrer(x, `${donde}[${i}]`));
        if (!nodo || typeof nodo !== 'object') return;
        if (typeof nodo.$ref === 'string') {
            const destino = nodo.$ref.replace(/^#\//, '').split('/').reduce((o, k) => (o ? o[k] : undefined), especificacion);
            if (destino === undefined) rotas.push(`${donde} → ${nodo.$ref}`);
        }
        for (const [k, v] of Object.entries(nodo)) recorrer(v, `${donde}.${k}`);
    })(especificacion, 'raíz');
    assert.deepEqual(rotas, []);
});

test('las rutas que piden sesión indican que usan el token (bearerAuth)', () => {
    const publicas = new Set(['/registro', '/api/login', '/api/verificar-correo', '/api/reenviar-verificacion',
        '/api/solicitar-recuperacion', '/api/validar-token-recuperacion', '/api/restablecer-password',
        '/api/ping', '/api/categorias', '/api/estadisticas']);
    for (const [ruta, item] of Object.entries(especificacion.paths)) {
        for (const metodo of METODOS) {
            const op = item[metodo];
            if (!op) continue;
            const esPublica = publicas.has(ruta) || (metodo === 'get' && ['/api/ofertas', '/api/subastas'].includes(ruta));
            const usaToken = (op.security || []).some(s => 'bearerAuth' in s);
            assert.equal(usaToken, !esPublica, `${metodo.toUpperCase()} ${ruta}`);
        }
    }
});
