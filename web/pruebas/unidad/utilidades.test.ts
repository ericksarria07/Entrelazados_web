// Pruebas unitarias de lib/utilidades.ts (funciones puras: sin base de datos ni servidor).
// Portadas de backend/pruebas/unidad/utilidades.test.js.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as u from "../../lib/utilidades.ts";

test("REGEX_EMAIL acepta correos completos y rechaza los incompletos", () => {
  for (const bueno of ["erick@gmail.com", "a.b+c@empresa.com.ni", "x@y.io"]) assert.ok(u.REGEX_EMAIL.test(bueno), bueno);
  for (const malo of ["erick@gmail", "erick@gmail.c", "sin-arroba.com", "con espacio@a.com", "@a.com", ""]) {
    assert.ok(!u.REGEX_EMAIL.test(malo), malo);
  }
});

test("esTokenValido exige 64 caracteres hexadecimales", () => {
  assert.ok(u.esTokenValido("a".repeat(64)));
  assert.ok(u.esTokenValido("0123456789ABCDEF".repeat(4)));
  assert.ok(!u.esTokenValido("a".repeat(63)));
  assert.ok(!u.esTokenValido("g".repeat(64)));
  assert.ok(!u.esTokenValido(undefined));
  assert.ok(!u.esTokenValido(["a".repeat(64)]), "?token=a&token=b llega como lista");
});

test("textoLimpio recorta los espacios y descarta lo que no es texto", () => {
  assert.equal(u.textoLimpio("  hola  "), "hola");
  assert.equal(u.textoLimpio(42), "");
  assert.equal(u.textoLimpio(null), "");
  assert.equal(u.textoLimpio({ $ne: 1 }), "");
});

test("enteroPositivo solo acepta enteros mayores que 0", () => {
  assert.equal(u.enteroPositivo("7"), 7);
  assert.equal(u.enteroPositivo(3), 3);
  for (const malo of ["0", "-2", "1.5", "abc", "", null, undefined]) assert.equal(u.enteroPositivo(malo), null, String(malo));
});

test("leerPaginacion: sin ?pagina devuelve null (lista completa)", () => {
  assert.equal(u.leerPaginacion(new URLSearchParams("")), null);
  assert.equal(u.leerPaginacion(new URLSearchParams("porPagina=5")), null);
});

test("leerPaginacion: calcula el desplazamiento y respeta el máximo", () => {
  const p = (q: string, ...resto: number[]) => u.leerPaginacion(new URLSearchParams(q), ...resto);
  assert.deepEqual(p("pagina=3&porPagina=10"), { pagina: 3, porPagina: 10, offset: 20 });
  assert.deepEqual(p("pagina=1", 12), { pagina: 1, porPagina: 12, offset: 0 });
  assert.equal(p("pagina=1&porPagina=999", 12, 50)?.porPagina, 50);
  assert.equal(p("pagina=-4")?.pagina, 1);
  assert.equal(p("pagina=abc")?.pagina, 1);
  assert.equal(p("pagina=1&porPagina=0", 12)?.porPagina, 12);
});

test("respuestaPaginada calcula el total de páginas (mínimo 1)", () => {
  const p = { pagina: 2, porPagina: 10, offset: 10 };
  assert.deepEqual(u.respuestaPaginada(["a"], 25, p), { datos: ["a"], total: 25, pagina: 2, porPagina: 10, paginas: 3 });
  assert.equal(u.respuestaPaginada([], 0, p).paginas, 1);
});

test("patronLike toma literales los comodines que escribe el usuario", () => {
  assert.equal(u.patronLike("cuero"), "%cuero%");
  assert.equal(u.patronLike("  50%_off\\ "), "%50\\%\\_off\\\\%");
  assert.equal(u.patronLike("x".repeat(300)).length, 102, "máximo 100 caracteres + los dos %");
});

test("ocultarCorreo deja ver solo la primera y la última letra", () => {
  assert.equal(u.ocultarCorreo("erick@gmail.com"), "e***k@gmail.com");
  assert.equal(u.ocultarCorreo("ab@x.com"), "a***@x.com");
  assert.equal(u.ocultarCorreo("sin-arroba"), "");
});

test("redondearCalificacion deja un decimal o null", () => {
  assert.equal(u.redondearCalificacion("4.6667"), 4.7);
  assert.equal(u.redondearCalificacion(5), 5);
  assert.equal(u.redondearCalificacion(null), null);
  assert.equal(u.redondearCalificacion(undefined), null);
});

test("leerFotosAntiguas lee la lista JSON vieja y descarta lo que no sirve", () => {
  assert.deepEqual(u.leerFotosAntiguas('["/a.jpg","/b.jpg"]'), ["/a.jpg", "/b.jpg"]);
  assert.deepEqual(u.leerFotosAntiguas('["/a.jpg", 3, null]'), ["/a.jpg"]);
  assert.deepEqual(u.leerFotosAntiguas("no es json"), []);
  assert.deepEqual(u.leerFotosAntiguas('{"a":1}'), []);
  assert.deepEqual(u.leerFotosAntiguas(null), []);
});

test("cordobas da el formato de la página (C$ con dos decimales)", () => {
  assert.equal(u.cordobas(1234.5), "C$1,234.50");
  assert.equal(u.cordobas("400"), "C$400.00");
  assert.equal(u.cordobas(0), "C$0.00");
});

// ---------------------------------------------------------------- MEDICIÓN (Analytics)
test("sinDatosPrivados quita el token de la dirección y deja lo demás", async () => {
  const { sinDatosPrivados } = await import("../../lib/medicion.ts");
  assert.equal(sinDatosPrivados("https://e.com/restablecer?token=abc123"), "https://e.com/restablecer");
  assert.equal(sinDatosPrivados("https://e.com/verificar?token=x&a=1"), "https://e.com/verificar?a=1");
  assert.equal(sinDatosPrivados("https://e.com/mercado?q=cuero"), "https://e.com/mercado?q=cuero");
  assert.equal(sinDatosPrivados("no es una url"), "no es una url");
});

// ---------------------------------------------------------------- FOTOS DE UNSPLASH
test("fotoUnsplash pide la foto del ancho en que se muestra (1x y 2x)", async () => {
  const { fotoUnsplash } = await import("../../lib/unsplash.ts");
  const f = fotoUnsplash("https://images.unsplash.com/photo-1?q=80&w=1190&auto=format", 340);
  assert.equal(f.src, "https://images.unsplash.com/photo-1?q=80&w=340&auto=format");
  assert.equal(f.srcSet, "https://images.unsplash.com/photo-1?q=80&w=340&auto=format 1x, https://images.unsplash.com/photo-1?q=80&w=680&auto=format 2x");
  assert.equal(fotoUnsplash("https://images.unsplash.com/photo-2", 165).src, "https://images.unsplash.com/photo-2?w=165");
});
