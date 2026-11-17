// ==========================================================================
// UTILIDADES COMPARTIDAS POR LAS RUTAS (equivale a backend/entrelazados-api/utilidades.js)
// El resto de las funciones llega con las rutas que las usan.
// ==========================================================================

export const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// La misma regla para Postgres (operador ~), para buscar correos inválidos en la base
export const REGEXP_EMAIL_SQL = "^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]{2,}$";

// Los tokens de los enlaces (recuperación y confirmación) son 32 bytes en hexadecimal
export const esTokenValido = (token: unknown): token is string =>
  typeof token === "string" && /^[a-f0-9]{64}$/i.test(token);

export const textoLimpio = (valor: unknown): string => (typeof valor === "string" ? valor.trim() : "");

// "erick@gmail.com" -> "e***k@gmail.com" (para mostrar sin revelar el correo completo)
export function ocultarCorreo(correo: string): string {
  const [nombre, dominio] = String(correo).split("@");
  if (!dominio) return "";
  const visible = nombre.length <= 2 ? nombre[0] + "***" : nombre[0] + "***" + nombre[nombre.length - 1];
  return `${visible}@${dominio}`;
}

export const enteroPositivo = (valor: unknown): number | null => {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export type Paginacion = { pagina: number; porPagina: number; offset: number };

// PAGINACIÓN: ?pagina=N&porPagina=M. Si no se pide ?pagina devuelve null y la ruta
// responde la lista completa (compatibilidad con pantallas y scripts viejos).
export function leerPaginacion(query: URLSearchParams, porPaginaDefecto = 12, maximo = 50): Paginacion | null {
  if (!query.has("pagina")) return null;
  const pagina = Math.max(1, parseInt(query.get("pagina") ?? "", 10) || 1);
  const porPagina = Math.min(maximo, Math.max(1, parseInt(query.get("porPagina") ?? "", 10) || porPaginaDefecto));
  return { pagina, porPagina, offset: (pagina - 1) * porPagina };
}

export const respuestaPaginada = <T>(datos: T[], total: number, p: Paginacion) => ({
  datos,
  total,
  pagina: p.pagina,
  porPagina: p.porPagina,
  paginas: Math.max(1, Math.ceil(total / p.porPagina)),
});

// Texto para buscar con ILIKE: los comodines % y _ que escriba el usuario se toman literales.
// Se usa con unaccent(columna) ILIKE unaccent($n): sin acentos ni mayúsculas, como MySQL.
export const patronLike = (texto: string) => `%${String(texto).trim().slice(0, 100).replace(/[\\%_]/g, "\\$&")}%`;

// Promedio de estrellas con un decimal (o null si no hay calificaciones)
export const redondearCalificacion = (valor: unknown) =>
  valor === null || valor === undefined ? null : Math.round(Number(valor) * 10) / 10;

// Fotos antiguas guardadas como texto JSON en ofertas.fotos: se siguen mostrando
// mientras la oferta no tenga fotos en la tabla fotos_ofertas.
export function leerFotosAntiguas(valor: unknown): string[] {
  try {
    const lista = valor ? JSON.parse(String(valor)) : [];
    return Array.isArray(lista) ? lista.filter((f) => typeof f === "string") : [];
  } catch {
    return [];
  }
}

// 'C$1,234.50' como lo muestra la página
export const cordobas = (monto: unknown) =>
  "C$" + Number(monto).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
