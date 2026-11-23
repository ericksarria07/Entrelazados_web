// Reglas de negocio que no dependen de la base de datos: validar una publicación, la máquina
// de estados de los tratos, las respuestas fijas de Kan y los roles.
// Portadas de backend/pruebas/unidad/reglas_negocio.test.js.
import assert from "node:assert/strict";
import { test } from "node:test";
import { esRolAdmin, inicioSegunRol } from "../../lib/cliente/sesion.ts";
import { leerHistorial, respuestaFija } from "../../lib/kan-respuestas.ts";
import { nombreLote } from "../../lib/lotes.ts";
import { DIAS_SUBASTA, PRECIO_MAXIMO, validarOferta } from "../../lib/ofertas-reglas.ts";
import { ESTADOS_ORIGEN, loteDelTrato } from "../../lib/tratos-estados.ts";

const ofertaValida = { titulo: "  Cuero vacuno  ", precio: "450", unidad: " pie² ", categoriaId: "1", distancia: "12.4" };
// validarOferta devuelve { error } o los datos: para leer el error sin pelear con los tipos
const error = (r: ReturnType<typeof validarOferta>) => ("error" in r ? r.error : undefined);
const datos = (r: ReturnType<typeof validarOferta>) => {
  assert.ok(!("error" in r), "error" in r ? r.error : "");
  return r;
};

test("validarOferta limpia y convierte los datos de una publicación correcta", () => {
  assert.deepEqual(validarOferta(ofertaValida), {
    titulo: "Cuero vacuno",
    unidad: "pie²",
    precio: 450,
    categoriaId: 1,
    distancia: 12,
    descripcion: null,
  });
});

test("validarOferta acepta una descripción opcional de hasta 1000 caracteres", () => {
  assert.equal(datos(validarOferta({ ...ofertaValida, descripcion: "  Cuero firme, ideal para botas.  " })).descripcion, "Cuero firme, ideal para botas.");
  assert.equal(datos(validarOferta({ ...ofertaValida, descripcion: "   " })).descripcion, null);
  datos(validarOferta({ ...ofertaValida, descripcion: "x".repeat(1000) }));
  assert.match(error(validarOferta({ ...ofertaValida, descripcion: "x".repeat(1001) })) ?? "", /1000/);
});

test("validarOferta pide los campos obligatorios", () => {
  for (const falta of ["titulo", "precio", "unidad", "categoriaId"]) {
    assert.match(error(validarOferta({ ...ofertaValida, [falta]: "" })) ?? "", /campos obligatorios/, `sin ${falta}`);
  }
  assert.ok(error(validarOferta({ ...ofertaValida, titulo: "    " })), "título solo con espacios");
  assert.ok(error(validarOferta({ ...ofertaValida, categoriaId: "abc" })), "categoría no numérica");
});

test("validarOferta respeta los largos máximos", () => {
  assert.match(error(validarOferta({ ...ofertaValida, titulo: "x".repeat(121) })) ?? "", /120/);
  datos(validarOferta({ ...ofertaValida, titulo: "x".repeat(120) }));
  assert.match(error(validarOferta({ ...ofertaValida, unidad: "x".repeat(31) })) ?? "", /30/);
});

test("validarOferta rechaza precios que no son mayores que 0 o que no caben en la base", () => {
  for (const precio of ["-5", "abc", String(PRECIO_MAXIMO + 1)]) {
    assert.match(error(validarOferta({ ...ofertaValida, precio })) ?? "", /precio/, precio);
  }
  assert.equal(datos(validarOferta({ ...ofertaValida, precio: String(PRECIO_MAXIMO) })).precio, PRECIO_MAXIMO);
});

test("validarOferta deja la distancia entre 0 y 10 000 km", () => {
  assert.equal(datos(validarOferta({ ...ofertaValida, distancia: "-30" })).distancia, 0);
  assert.equal(datos(validarOferta({ ...ofertaValida, distancia: "999999" })).distancia, 10000);
  assert.equal(datos(validarOferta({ ...ofertaValida, distancia: undefined })).distancia, 0);
});

test("una subasta dura de 1 a 14 días (7 por defecto)", () => {
  assert.deepEqual(DIAS_SUBASTA, { minimo: 1, maximo: 14, porDefecto: 7 });
});

test("máquina de estados de los tratos: transiciones permitidas", () => {
  const puede = (de: string, a: keyof typeof ESTADOS_ORIGEN) => ESTADOS_ORIGEN[a].includes(de);
  assert.ok(puede("Pendiente", "EnProceso"));
  assert.ok(puede("Pendiente", "Completado"));
  assert.ok(puede("EnProceso", "Completado"));
  assert.ok(puede("Pendiente", "Cancelado"));
  assert.ok(puede("EnProceso", "Cancelado"));
});

test("máquina de estados de los tratos: Completado y Cancelado son finales", () => {
  for (const [destino, origenes] of Object.entries(ESTADOS_ORIGEN)) {
    assert.ok(!origenes.includes("Completado"), `Completado → ${destino}`);
    assert.ok(!origenes.includes("Cancelado"), `Cancelado → ${destino}`);
  }
  assert.ok(!("Pendiente" in ESTADOS_ORIGEN), "nadie vuelve a Pendiente");
  assert.ok(!ESTADOS_ORIGEN.EnProceso.includes("EnProceso"));
});

test("nombreLote y loteDelTrato dejan solo el nombre del material", () => {
  assert.equal(nombreLote("Lote Subasta: Cuero café"), "Cuero café");
  assert.equal(nombreLote(""), "tu lote");
  assert.equal(loteDelTrato("Subasta ganada: Lote Subasta: Cuero café"), "Cuero café");
  assert.equal(loteDelTrato("Suela de hule"), "Suela de hule");
  assert.equal(loteDelTrato(null), "tu lote");
});

test("Kan saluda sin gastar la cuota de Gemini", () => {
  for (const saludo of ["hola", "hola kan", "buenas", "saludos"]) assert.match(respuestaFija(saludo, false) ?? "", /Soy Kan/, saludo);
});

test("Kan responde las preguntas frecuentes con texto fijo", () => {
  assert.match(respuestaFija("¿cómo funcionan las pujas?", false) ?? "", /Subastas/);
  assert.match(respuestaFija("cómo busco materia prima", false) ?? "", /Mercado/);
});

test("Kan da respuestas de administración solo al administrador", () => {
  assert.match(respuestaFija("quiero ver las métricas", true) ?? "", /Panel de Administración/);
  assert.equal(respuestaFija("quiero ver las métricas", false), null);
});

test("Kan deja a Gemini lo que no tiene respuesta fija", () => {
  assert.equal(respuestaFija("¿qué cuero me recomiendas para botas?", false), null);
});

test("leerHistorial: solo los últimos 10 mensajes válidos, cortados a 1000 caracteres", () => {
  assert.deepEqual(leerHistorial("no es lista"), []);
  assert.deepEqual(leerHistorial(null), []);
  const muchos = Array.from({ length: 15 }, (_, i) => ({ rol: i % 2 ? "kan" : "usuario", texto: `mensaje ${i}` }));
  const leido = leerHistorial(muchos);
  assert.equal(leido.length, 10);
  assert.equal(leido[0].texto, "mensaje 5");
  assert.deepEqual(
    leerHistorial([{ rol: "admin", texto: "x" }, { rol: "usuario", texto: "   " }, { rol: "kan" }, null, { rol: "usuario", texto: "  hola  " }]),
    [{ rol: "usuario", texto: "hola" }]
  );
  assert.equal(leerHistorial([{ rol: "usuario", texto: "x".repeat(5000) }])[0].texto.length, 1000);
});

test("esRolAdmin reconoce los dos nombres del rol, sin importar mayúsculas", () => {
  assert.ok(esRolAdmin("administrador"));
  assert.ok(esRolAdmin("Admin"));
  assert.ok(!esRolAdmin("proveedor"));
  assert.ok(!esRolAdmin(null));
  assert.equal(inicioSegunRol("Administrador"), "/admin");
  assert.equal(inicioSegunRol("emprendedor"), "/inicio");
});
