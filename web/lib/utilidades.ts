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
