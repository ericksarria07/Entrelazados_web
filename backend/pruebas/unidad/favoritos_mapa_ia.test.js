// Reglas de la versión 13 que no necesitan base de datos: alertas de búsqueda,
// departamentos del mapa y los cálculos del asistente de precios.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarAlerta, cumpleAlerta, describirAlerta } = require('../../entrelazados-api/servicios/favoritos');
const { ubicarDepartamento, DEPARTAMENTOS } = require('../../entrelazados-api/servicios/departamentos');
const { normalizarUnidad, estadisticas, precioRazonable, redondearPrecio } = require('../../entrelazados-api/servicios/asistenteIA');

// ---------------------------------------------------------------- ALERTAS
test('validarAlerta pide la palabra clave o la categoría', () => {
    assert.match(validarAlerta({}).error, /palabra clave o elige una categoría/);
    assert.match(validarAlerta({ palabraClave: '   ', categoriaId: '' }).error, /palabra clave/);
    assert.match(validarAlerta({ precioMaximo: 300 }).error, /palabra clave/, 'solo el precio no basta');
    assert.deepEqual(validarAlerta({ palabraClave: '  cuero   café ' }), { palabraClave: 'cuero café', categoriaId: null, precioMaximo: null });
    assert.deepEqual(validarAlerta({ categoriaId: '3', precioMaximo: '450.5' }), { palabraClave: null, categoriaId: 3, precioMaximo: 450.5 });
    assert.deepEqual(validarAlerta({ palabraClave: 'suela', categoriaId: 'todos' }), { palabraClave: 'suela', categoriaId: null, precioMaximo: null });
});

test('validarAlerta rechaza categorías, precios y palabras inválidas', () => {
    assert.match(validarAlerta({ categoriaId: 'abc' }).error, /categoría/);
    assert.match(validarAlerta({ categoriaId: -2 }).error, /categoría/);
    assert.match(validarAlerta({ palabraClave: 'cuero', precioMaximo: 0 }).error, /precio/);
    assert.match(validarAlerta({ palabraClave: 'cuero', precioMaximo: 'mucho' }).error, /precio/);
    assert.match(validarAlerta({ palabraClave: 'x'.repeat(61) }).error, /60/);
    assert.match(validarAlerta({ palabraClave: { $ne: 1 } }).error, /palabra clave/, 'un objeto no cuenta como texto');
});

test('cumpleAlerta: todas las palabras, sin importar mayúsculas, tildes ni orden', () => {
    const oferta = { titulo: 'Cuero vacuno CAFÉ curtido', descripcion: 'Ideal para botas', categoriaId: 1, precio: 450 };
    assert.ok(cumpleAlerta({ PalabraClave: 'cafe cuero' }, oferta));
    assert.ok(cumpleAlerta({ PalabraClave: 'BOTAS' }, oferta), 'también busca en la descripción');
    assert.ok(!cumpleAlerta({ PalabraClave: 'cuero negro' }, oferta), 'falta "negro"');
    assert.ok(cumpleAlerta({ CategoriaID: 1, PrecioMaximo: '450.00' }, oferta), 'precio igual al máximo sí cumple');
    assert.ok(!cumpleAlerta({ CategoriaID: 1, PrecioMaximo: 449.99 }, oferta));
    assert.ok(!cumpleAlerta({ CategoriaID: 2 }, oferta));
    assert.ok(cumpleAlerta({ PalabraClave: 'cuero', CategoriaID: null, PrecioMaximo: null }, oferta));
});

test('describirAlerta arma un texto corto', () => {
    assert.equal(describirAlerta({ PalabraClave: 'suela', NombreCategoria: 'Suelas', PrecioMaximo: 500 }), '«suela» en Suelas hasta C$500');
    assert.equal(describirAlerta({ PalabraClave: null, NombreCategoria: 'Hilos', PrecioMaximo: null }), 'en Hilos');
});

// ---------------------------------------------------------------- DEPARTAMENTOS
test('ubicarDepartamento reconoce los 17 departamentos y regiones escritos de cualquier forma', () => {
    assert.equal(DEPARTAMENTOS.length, 17);
    for (const d of DEPARTAMENTOS) assert.equal(ubicarDepartamento(d.nombre).nombre, d.nombre);
    assert.equal(ubicarDepartamento('  leon ').nombre, 'León');
    assert.equal(ubicarDepartamento('ESTELI').nombre, 'Estelí');
    assert.equal(ubicarDepartamento('Rio San Juan').nombre, 'Río San Juan');
    assert.equal(ubicarDepartamento('Departamento de Masaya').nombre, 'Masaya');
    assert.equal(ubicarDepartamento('Managua, Nicaragua').nombre, 'Managua');
    assert.equal(ubicarDepartamento('Managua centro').nombre, 'Managua');
    assert.equal(ubicarDepartamento('RAAN').nombre, 'Costa Caribe Norte');
    assert.equal(ubicarDepartamento('Bluefields').nombre, 'Costa Caribe Sur');
    const masaya = ubicarDepartamento('masaya');
    assert.ok(masaya.lat > 10.7 && masaya.lat < 15.1 && masaya.lng > -87.7 && masaya.lng < -82.5, 'dentro de Nicaragua');
});

test('ubicarDepartamento devuelve null si no lo reconoce', () => {
    for (const texto of ['', null, undefined, 'Tegucigalpa', 'Nueva', 'xyz']) assert.equal(ubicarDepartamento(texto), null, String(texto));
});

// ---------------------------------------------------------------- ASISTENTE DE PRECIOS
test('normalizarUnidad junta las formas de escribir la misma unidad', () => {
    for (const u of ['por pie²', 'Pie2', 'pies cuadrados', 'por pie 2']) assert.equal(normalizarUnidad(u), 'pie2', u);
    for (const u of ['por par', 'Pares', 'el par']) assert.equal(normalizarUnidad(u), 'par', u);
    for (const u of ['por docena', 'Docenas']) assert.equal(normalizarUnidad(u), 'docena', u);
    for (const u of ['por unidad', 'c/u', 'pieza']) assert.equal(normalizarUnidad(u), 'unidad', u);
    assert.equal(normalizarUnidad('por metro'), 'm');
    assert.notEqual(normalizarUnidad('por metro'), normalizarUnidad('por m²'));
});

test('estadisticas calcula mínimo, máximo, promedio y mediana', () => {
    assert.equal(estadisticas([]), null);
    assert.deepEqual(estadisticas([300, '100', 200, 0, -5]), { muestras: 3, minimo: 100, maximo: 300, promedio: 200, mediana: 200 });
    assert.equal(estadisticas([100, 200, 400, 1000]).mediana, 300);
});

test('precioRazonable descarta precios fuera de lugar y redondearPrecio deja precios de tienda', () => {
    const est = estadisticas([200, 300, 400]);
    assert.ok(precioRazonable(320, est));
    assert.ok(!precioRazonable(50, est), 'menos de la mitad del mínimo');
    assert.ok(!precioRazonable(900, est), 'más de 1.5 veces el máximo');
    assert.ok(!precioRazonable('abc', est));
    assert.equal(redondearPrecio(47.3), 47);
    assert.equal(redondearPrecio(452), 450);
    assert.equal(redondearPrecio(1234), 1230);
    assert.equal(redondearPrecio(0.2), 1);
});
