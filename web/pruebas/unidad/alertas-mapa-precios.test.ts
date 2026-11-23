// Reglas que no necesitan base de datos: alertas de búsqueda, departamentos del mapa y
// los cálculos del asistente de precios. Portadas de backend/pruebas/unidad/favoritos_mapa_ia.test.js.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cumpleAlerta, describirAlerta, validarAlerta } from "../../lib/alertas.ts";
import { DEPARTAMENTOS, ubicarDepartamento } from "../../lib/departamentos.ts";
import { estadisticas, normalizarUnidad, precioRazonable, redondearPrecio } from "../../lib/reglas-precio.ts";

const error = (r: ReturnType<typeof validarAlerta>): string => ("error" in r && r.error) || "";

// ---------------------------------------------------------------- ALERTAS
test("validarAlerta pide la palabra clave o la categoría", () => {
  assert.match(error(validarAlerta({})), /palabra clave o elige una categoría/);
  assert.match(error(validarAlerta({ palabraClave: "   ", categoriaId: "" })), /palabra clave/);
  assert.match(error(validarAlerta({ precioMaximo: 300 })), /palabra clave/, "solo el precio no basta");
  assert.deepEqual(validarAlerta({ palabraClave: "  cuero   café " }), { palabraClave: "cuero café", categoriaId: null, precioMaximo: null });
  assert.deepEqual(validarAlerta({ categoriaId: "3", precioMaximo: "450.5" }), { palabraClave: null, categoriaId: 3, precioMaximo: 450.5 });
  assert.deepEqual(validarAlerta({ palabraClave: "suela", categoriaId: "todos" }), { palabraClave: "suela", categoriaId: null, precioMaximo: null });
});

test("validarAlerta rechaza categorías, precios y palabras inválidas", () => {
  assert.match(error(validarAlerta({ categoriaId: "abc" })), /categoría/);
  assert.match(error(validarAlerta({ categoriaId: -2 })), /categoría/);
  assert.match(error(validarAlerta({ palabraClave: "cuero", precioMaximo: 0 })), /precio/);
  assert.match(error(validarAlerta({ palabraClave: "cuero", precioMaximo: "mucho" })), /precio/);
  assert.match(error(validarAlerta({ palabraClave: "x".repeat(61) })), /60/);
  assert.match(error(validarAlerta({ palabraClave: { $ne: 1 } })), /palabra clave/, "un objeto no cuenta como texto");
});

test("cumpleAlerta: todas las palabras, sin importar mayúsculas, tildes ni orden", () => {
  const oferta = { ofertaId: 1, proveedorId: 2, titulo: "Cuero vacuno CAFÉ curtido", descripcion: "Ideal para botas", categoriaId: 1, precio: 450 };
  const alerta = (a: Partial<Parameters<typeof cumpleAlerta>[0]>) => ({ PalabraClave: null, CategoriaID: null, PrecioMaximo: null, ...a });
  assert.ok(cumpleAlerta(alerta({ PalabraClave: "cafe cuero" }), oferta));
  assert.ok(cumpleAlerta(alerta({ PalabraClave: "BOTAS" }), oferta), "también busca en la descripción");
  assert.ok(!cumpleAlerta(alerta({ PalabraClave: "cuero negro" }), oferta), 'falta "negro"');
  assert.ok(cumpleAlerta(alerta({ CategoriaID: 1, PrecioMaximo: "450.00" }), oferta), "precio igual al máximo sí cumple");
  assert.ok(!cumpleAlerta(alerta({ CategoriaID: 1, PrecioMaximo: 449.99 }), oferta));
  assert.ok(!cumpleAlerta(alerta({ CategoriaID: 2 }), oferta));
  assert.ok(cumpleAlerta(alerta({ PalabraClave: "cuero" }), oferta));
});

test("describirAlerta arma un texto corto", () => {
  assert.equal(describirAlerta({ PalabraClave: "suela", CategoriaID: 3, NombreCategoria: "Suelas", PrecioMaximo: 500 }), "«suela» en Suelas hasta C$500");
  assert.equal(describirAlerta({ PalabraClave: null, CategoriaID: 4, NombreCategoria: "Hilos", PrecioMaximo: null }), "en Hilos");
});

// ---------------------------------------------------------------- DEPARTAMENTOS
test("ubicarDepartamento reconoce los 17 departamentos y regiones escritos de cualquier forma", () => {
  assert.equal(DEPARTAMENTOS.length, 17);
  for (const d of DEPARTAMENTOS) assert.equal(ubicarDepartamento(d.nombre)?.nombre, d.nombre);
  assert.equal(ubicarDepartamento("  leon ")?.nombre, "León");
  assert.equal(ubicarDepartamento("ESTELI")?.nombre, "Estelí");
  assert.equal(ubicarDepartamento("Rio San Juan")?.nombre, "Río San Juan");
  assert.equal(ubicarDepartamento("Departamento de Masaya")?.nombre, "Masaya");
  assert.equal(ubicarDepartamento("Managua, Nicaragua")?.nombre, "Managua");
  assert.equal(ubicarDepartamento("Managua centro")?.nombre, "Managua");
  assert.equal(ubicarDepartamento("RAAN")?.nombre, "Costa Caribe Norte");
  assert.equal(ubicarDepartamento("Bluefields")?.nombre, "Costa Caribe Sur");
  const masaya = ubicarDepartamento("masaya");
  assert.ok(masaya && masaya.lat > 10.7 && masaya.lat < 15.1 && masaya.lng > -87.7 && masaya.lng < -82.5, "dentro de Nicaragua");
});

test("ubicarDepartamento devuelve null si no lo reconoce", () => {
  for (const texto of ["", null, undefined, "Tegucigalpa", "Nueva", "xyz"]) assert.equal(ubicarDepartamento(texto), null, String(texto));
});

// ---------------------------------------------------------------- ASISTENTE DE PRECIOS
test("normalizarUnidad junta las formas de escribir la misma unidad", () => {
  for (const u of ["por pie²", "Pie2", "pies cuadrados", "por pie 2"]) assert.equal(normalizarUnidad(u), "pie2", u);
  for (const u of ["por par", "Pares", "el par"]) assert.equal(normalizarUnidad(u), "par", u);
  for (const u of ["por docena", "Docenas"]) assert.equal(normalizarUnidad(u), "docena", u);
  for (const u of ["por unidad", "c/u", "pieza"]) assert.equal(normalizarUnidad(u), "unidad", u);
  assert.equal(normalizarUnidad("por metro"), "m");
  assert.notEqual(normalizarUnidad("por metro"), normalizarUnidad("por m²"));
});

test("estadisticas calcula mínimo, máximo, promedio y mediana", () => {
  assert.equal(estadisticas([]), null);
  assert.deepEqual(estadisticas([300, "100", 200, 0, -5]), { muestras: 3, minimo: 100, maximo: 300, promedio: 200, mediana: 200 });
  assert.equal(estadisticas([100, 200, 400, 1000])?.mediana, 300);
});

test("precioRazonable descarta precios fuera de lugar y redondearPrecio deja precios de tienda", () => {
  const est = estadisticas([200, 300, 400]);
  assert.ok(est);
  assert.ok(precioRazonable(320, est));
  assert.ok(!precioRazonable(50, est), "menos de la mitad del mínimo");
  assert.ok(!precioRazonable(900, est), "más de 1.5 veces el máximo");
  assert.ok(!precioRazonable("abc", est));
  assert.equal(redondearPrecio(47.3), 47);
  assert.equal(redondearPrecio(452), 450);
  assert.equal(redondearPrecio(1234), 1230);
  assert.equal(redondearPrecio(0.2), 1);
});
