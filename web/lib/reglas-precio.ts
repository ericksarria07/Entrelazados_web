// ==========================================================================
// REGLAS DEL ASISTENTE DE PRECIOS (sin dependencias)
// Las usa lib/asistente-ia.ts y también las pruebas (sección 29), que importan este
// archivo directamente con Node: por eso no importa nada y solo usa tipos simples.
// ==========================================================================

// "por pie²", "Pie2", "pies cuadrados" -> "pie2" (para comparar solo precios de la misma unidad)
export function normalizarUnidad(texto: unknown): string {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/\bc\/u\b/g, "unidad")
    .replace(/\bpor\b|\bcada\b|\bla\b|\bel\b|\bun[ao]?\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^pies? ?(2|cuadrados?)$/.test(t)) return "pie2";
  if (/^(m|metros?) ?(2|cuadrados?)$/.test(t)) return "m2";
  if (/^(m|metros?)( lineal(es)?)?$/.test(t)) return "m";
  if (/^pares?$/.test(t)) return "par";
  if (/^docenas?$/.test(t)) return "docena";
  if (/^(unidad(es)?|u|pieza(s)?)$/.test(t)) return "unidad";
  if (/^(kg|kilos?|kilogramos?)$/.test(t)) return "kg";
  if (/^(lb|libras?)$/.test(t)) return "lb";
  if (/^(galon(es)?|gal)$/.test(t)) return "galon";
  if (/^(rollos?)$/.test(t)) return "rollo";
  return t.replace(/s$/, "");
}

// Mínimo, máximo, promedio y mediana de una lista de precios (null si está vacía)
export function estadisticas(precios: unknown[]) {
  const lista = precios
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (lista.length === 0) return null;
  const mitad = Math.floor(lista.length / 2);
  const mediana =
    lista.length % 2 ? lista[mitad] : (lista[mitad - 1] + lista[mitad]) / 2;
  const redondear = (n: number) => Math.round(n * 100) / 100;
  return {
    muestras: lista.length,
    minimo: lista[0],
    maximo: lista[lista.length - 1],
    promedio: redondear(lista.reduce((s, n) => s + n, 0) / lista.length),
    mediana: redondear(mediana),
  };
}

// Un precio propuesto por la IA solo se acepta si es razonable respecto a las publicaciones parecidas
export function precioRazonable(
  precio: unknown,
  est: ReturnType<typeof estadisticas>,
) {
  const n = Number(precio);
  if (!(n > 0)) return false;
  if (!est) return n < 99999999;
  return n >= est.minimo * 0.5 && n <= est.maximo * 1.5;
}

// Redondeo "de tienda": hasta C$100 a 1 córdoba, hasta C$1000 a 5, más arriba a 10
export function redondearPrecio(n: number) {
  const paso = n < 100 ? 1 : n < 1000 ? 5 : 10;
  return Math.max(paso, Math.round(n / paso) * paso);
}
