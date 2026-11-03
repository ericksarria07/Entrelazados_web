// Pruebas unitarias de las reglas de negocio que no dependen de la base de datos:
// validar una publicación, la máquina de estados de los tratos y las respuestas fijas de Kan.
require('./ayudas');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarOferta, DIAS_SUBASTA, PRECIO_MAXIMO } = require('../../entrelazados-api/servicios/ofertas');
const { ESTADOS_ORIGEN, loteDelTrato } = require('../../entrelazados-api/servicios/tratos');
const { respuestaFija } = require('../../entrelazados-api/servicios/kan');
const { esRolAdmin } = require('../../entrelazados-api/middlewares/autenticacion');

const ofertaValida = { titulo: '  Cuero vacuno  ', precio: '450', unidad: ' pie² ', categoriaId: '1', distancia: '12.4' };

test('validarOferta limpia y convierte los datos de una publicación correcta', () => {
    assert.deepEqual(validarOferta(ofertaValida), {
        titulo: 'Cuero vacuno', unidad: 'pie²', precio: 450, categoriaId: 1, distancia: 12
    });
});

test('validarOferta pide los campos obligatorios', () => {
    for (const falta of ['titulo', 'precio', 'unidad', 'categoriaId']) {
        const datos = { ...ofertaValida, [falta]: '' };
        assert.match(validarOferta(datos).error, /campos obligatorios/, `sin ${falta}`);
    }
    assert.ok(validarOferta({ ...ofertaValida, titulo: '    ' }).error, 'título solo con espacios');
    assert.ok(validarOferta({ ...ofertaValida, categoriaId: 'abc' }).error, 'categoría no numérica');
});

test('validarOferta respeta los largos máximos', () => {
    assert.match(validarOferta({ ...ofertaValida, titulo: 'x'.repeat(121) }).error, /120/);
    assert.ok(!validarOferta({ ...ofertaValida, titulo: 'x'.repeat(120) }).error);
    assert.match(validarOferta({ ...ofertaValida, unidad: 'x'.repeat(31) }).error, /30/);
});

test('validarOferta rechaza precios que no son mayores que 0 o que no caben en la base', () => {
    for (const precio of ['-5', 'abc', String(PRECIO_MAXIMO + 1)]) {
        assert.match(validarOferta({ ...ofertaValida, precio }).error, /precio/, precio);
    }
    assert.equal(validarOferta({ ...ofertaValida, precio: String(PRECIO_MAXIMO) }).precio, PRECIO_MAXIMO);
});

test('validarOferta deja la distancia entre 0 y 10 000 km', () => {
    assert.equal(validarOferta({ ...ofertaValida, distancia: '-30' }).distancia, 0);
    assert.equal(validarOferta({ ...ofertaValida, distancia: '999999' }).distancia, 10000);
    assert.equal(validarOferta({ ...ofertaValida, distancia: undefined }).distancia, 0);
});

test('una subasta dura de 1 a 14 días (7 por defecto)', () => {
    assert.deepEqual(DIAS_SUBASTA, { minimo: 1, maximo: 14, porDefecto: 7 });
});

test('máquina de estados de los tratos: transiciones permitidas', () => {
    const puede = (de, a) => (ESTADOS_ORIGEN[a] || []).includes(de);
    assert.ok(puede('Pendiente', 'EnProceso'));
    assert.ok(puede('Pendiente', 'Completado'));
    assert.ok(puede('EnProceso', 'Completado'));
    assert.ok(puede('Pendiente', 'Cancelado'));
    assert.ok(puede('EnProceso', 'Cancelado'));
});

test('máquina de estados de los tratos: Completado y Cancelado son finales', () => {
    for (const destino of Object.keys(ESTADOS_ORIGEN)) {
        assert.ok(!ESTADOS_ORIGEN[destino].includes('Completado'), `Completado → ${destino}`);
        assert.ok(!ESTADOS_ORIGEN[destino].includes('Cancelado'), `Cancelado → ${destino}`);
    }
    assert.equal(ESTADOS_ORIGEN.Pendiente, undefined, 'nadie vuelve a Pendiente');
    assert.ok(!ESTADOS_ORIGEN.EnProceso.includes('EnProceso'));
});

test('loteDelTrato saca el nombre del lote de la descripción del trato', () => {
    assert.equal(loteDelTrato('Subasta ganada: Lote Subasta: Cuero café'), 'Cuero café');
    assert.equal(loteDelTrato('Suela de hule'), 'Suela de hule');
    assert.equal(loteDelTrato(null), 'tu lote');
});

test('Kan saluda sin gastar la cuota de Gemini', () => {
    assert.match(respuestaFija('hola', false), /Soy Kan/);
    assert.match(respuestaFija('hola kan', false), /Soy Kan/);
    assert.match(respuestaFija('buenas', false), /Soy Kan/);
});

test('Kan responde las preguntas frecuentes con texto fijo', () => {
    assert.match(respuestaFija('¿cómo funcionan las pujas?', false), /Subastas/);
    assert.match(respuestaFija('cómo busco materia prima', false), /Mercado/);
});

test('Kan da respuestas de administración solo al administrador', () => {
    assert.match(respuestaFija('quiero ver las métricas', true), /Panel de Administración/);
    assert.equal(respuestaFija('quiero ver las métricas', false), null);
});

test('Kan deja a Gemini lo que no tiene respuesta fija', () => {
    assert.equal(respuestaFija('¿qué cuero me recomiendas para botas?', false), null);
});

test('esRolAdmin reconoce los dos nombres del rol', () => {
    assert.ok(esRolAdmin('administrador'));
    assert.ok(esRolAdmin('admin'));
    assert.ok(!esRolAdmin('proveedor'));
    assert.ok(!esRolAdmin('Administrador'), 'el rol llega ya en minúsculas');
});
