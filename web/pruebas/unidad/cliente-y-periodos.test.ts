// Ayudas del navegador (lib/cliente/) y los periodos de los reportes: enlaces viejos,
// montos en letras del comprobante, categorías por texto, contenido de Kan y fechas.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { buscarCategoriaPorTexto } from "../../lib/cliente/categorias.ts";
import { fechaExcel } from "../../lib/cliente/excel.ts";
import { contenidoKan } from "../../lib/cliente/kan-contenido.ts";
import { enLetras } from "../../lib/cliente/numeros.ts";
import { rutaNueva } from "../../lib/cliente/rutas.ts";
import { inicioDelPeriodo, leerMeses, mesesDelPeriodo } from "../../lib/periodos.ts";

test("rutaNueva pasa los enlaces .html viejos a las rutas de React", () => {
  assert.equal(rutaNueva("mercado.html#tab-auctions"), "/mercado#tab-auctions");
  assert.equal(rutaNueva("/chat.html?contacto=7"), "/chat?contacto=7");
  assert.equal(rutaNueva("index.html"), "/inicio");
  assert.equal(rutaNueva("preview.html"), "/");
  assert.equal(rutaNueva("/dashboard"), "/dashboard", "las rutas nuevas no cambian");
  assert.equal(rutaNueva("perfil"), "/perfil");
  assert.equal(rutaNueva("https://ejemplo.com/x.html"), "https://ejemplo.com/x.html");
});

test("enLetras escribe el monto del comprobante como en un cheque", () => {
  assert.equal(enLetras(0), "Cero córdobas con 00/100");
  assert.equal(enLetras(1350.5), "Mil trescientos cincuenta córdobas con 50/100");
  assert.equal(enLetras(100), "Cien córdobas con 00/100");
  assert.equal(enLetras(115), "Ciento quince córdobas con 00/100");
  assert.equal(enLetras(999999.99), "Novecientos noventa y nueve mil novecientos noventa y nueve córdobas con 99/100");
});

test('enLetras acorta "uno" antes del sustantivo: un córdoba, veintiún córdobas, un millón', () => {
  assert.equal(enLetras(1), "Un córdoba con 00/100");
  assert.equal(enLetras(21), "Veintiún córdobas con 00/100");
  assert.equal(enLetras(31), "Treinta y un córdobas con 00/100");
  assert.equal(enLetras(121000), "Ciento veintiún mil córdobas con 00/100");
  assert.equal(enLetras(21000000), "Veintiún millones de córdobas con 00/100");
});

test('enLetras usa "de" solo cuando el monto termina justo en millones', () => {
  assert.equal(enLetras(1000000), "Un millón de córdobas con 00/100");
  assert.equal(enLetras(2000000), "Dos millones de córdobas con 00/100");
  assert.equal(enLetras(1000500), "Un millón quinientos córdobas con 00/100");
  assert.equal(enLetras(2001000), "Dos millones mil córdobas con 00/100");
});

test("buscarCategoriaPorTexto elige la categoría que comparte más palabras", () => {
  const lista = [
    { CategoriaID: 1, NombreCategoria: "Cuero Bovino / Vacuno" },
    { CategoriaID: 2, NombreCategoria: "Herrajes, Hebillas y Mosquetones" },
    { CategoriaID: 3, NombreCategoria: "Suelas y Tacones" },
  ];
  assert.equal(buscarCategoriaPorTexto(lista, "Cuero Vacuno"), 1);
  assert.equal(buscarCategoriaPorTexto(lista, "herrajes"), 2);
  assert.equal(buscarCategoriaPorTexto(lista, "SUELAS"), 3);
  assert.equal(buscarCategoriaPorTexto(lista, "xyz"), null);
});

test("contenidoKan: según la página y el rol (el admin siempre ve el suyo)", () => {
  assert.match(contenidoKan("mercado", "Proveedor").saludo, /gestionar ofertas/);
  assert.match(contenidoKan("mercado", "emprendedor").saludo, /encontrar ofertas/);
  assert.match(contenidoKan("inicio", "admin").saludo, /Administrador/);
  assert.equal(contenidoKan("inicio", "administrador"), contenidoKan("dashboard", "Admin"));
  assert.ok(contenidoKan("dashboard", "proveedor").opciones.length > 0);
});

test("leerMeses solo acepta 3, 6 o 12 (6 por defecto)", () => {
  assert.equal(leerMeses("3"), 3);
  assert.equal(leerMeses(12), 12);
  for (const malo of ["5", "", null, "abc", 24]) assert.equal(leerMeses(malo), 6, String(malo));
});

test("mesesDelPeriodo da todos los meses del periodo, aunque cambie el año", () => {
  assert.deepEqual(mesesDelPeriodo(new Date(2026, 9, 1), 4), ["2026-10", "2026-11", "2026-12", "2027-01"]);
  assert.equal(mesesDelPeriodo(new Date(2026, 0, 1), 12).length, 12);
});

test("inicioDelPeriodo: primer día del mes, contando el mes actual", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date(2026, 1, 15, 10, 30) });
  try {
    const seis = inicioDelPeriodo(6);
    assert.deepEqual([seis.getFullYear(), seis.getMonth(), seis.getDate(), seis.getHours()], [2025, 8, 1, 0], "febrero 2026 - 5 meses = septiembre 2025");
    const tres = inicioDelPeriodo(3);
    assert.deepEqual([tres.getFullYear(), tres.getMonth()], [2025, 11]);
  } finally {
    mock.timers.reset();
  }
});

test("fechaExcel quita el corrimiento de la zona horaria", () => {
  const original = new Date("2026-11-23T15:00:00Z");
  const ajustada = fechaExcel(original);
  assert.equal(ajustada.getTime() - original.getTime(), -original.getTimezoneOffset() * 60000);
  assert.equal(fechaExcel("2026-11-23T15:00:00Z").getTime(), ajustada.getTime(), "acepta texto o Date");
});
