// Montos en letras para el comprobante: 1350.5 -> "Mil trescientos cincuenta córdobas con 50/100"
const UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece",
  "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
  "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function menorDeMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let texto = CENTENAS[c];
  if (resto) {
    const decenas = resto < 30 ? UNIDADES[resto] : DECENAS[Math.floor(resto / 10)] + (resto % 10 ? " y " + UNIDADES[resto % 10] : "");
    texto += (texto ? " " : "") + decenas;
  }
  return texto;
}

// Antes de un sustantivo "uno" se acorta: "veintiún mil", "treinta y un millones", "un córdoba"
const apocope = (t: string) => t.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");

export function enLetras(numero: number): string {
  const entero = Math.floor(numero);
  const centavos = Math.round((numero - entero) * 100);
  const millones = Math.floor(entero / 1e6);
  const miles = Math.floor((entero % 1e6) / 1000);
  const resto = entero % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "un millón" : apocope(menorDeMil(millones)) + " millones");
  if (miles) partes.push(miles === 1 ? "mil" : apocope(menorDeMil(miles)) + " mil");
  if (resto) partes.push(apocope(menorDeMil(resto)));
  let texto = partes.join(" ") || "cero";
  texto = texto.charAt(0).toUpperCase() + texto.slice(1);
  // "un millón de córdobas", pero "un millón quinientos córdobas"
  const de = millones && !miles && !resto ? " de" : "";
  return `${texto}${de} córdoba${entero === 1 ? "" : "s"} con ${String(centavos).padStart(2, "0")}/100`;
}
