// Formatos de números, fechas y textos del dashboard
const fmtEntero = new Intl.NumberFormat("es-NI", { maximumFractionDigits: 0 });
const fmtDecimal = new Intl.NumberFormat("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const entero = (n: number) => fmtEntero.format(Number(n) || 0);
export const dinero = (n: number) => "C$ " + fmtDecimal.format(Number(n) || 0);
export const dineroCorto = (n: number) => "C$ " + fmtEntero.format(Math.round(Number(n) || 0));
export const porcentaje = (n: number) => (Number(n) || 0).toLocaleString("es-NI", { maximumFractionDigits: 1 }) + "%";

export function nombreMes(clave: string, largo = false) {
  const [a, m] = clave.split("-").map(Number);
  const txt = new Date(a, m - 1, 1).toLocaleDateString(
    "es-NI",
    largo ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" }
  );
  return txt.charAt(0).toUpperCase() + txt.slice(1).replace(".", "");
}

export function tiempoRestante(fecha: string) {
  const ms = new Date(fecha).getTime() - Date.now();
  if (ms <= 0) return "Finalizada";
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440),
    h = Math.floor((min % 1440) / 60),
    m = min % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function haceCuanto(fecha: string) {
  const seg = Math.max(0, (Date.now() - new Date(fecha).getTime()) / 1000);
  if (seg < 60) return "hace un momento";
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  if (seg < 604800) return `hace ${Math.floor(seg / 86400)} d`;
  return new Date(fecha).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" });
}

// "Lote Subasta: Cuero vacuno" → "Cuero vacuno"
export const nombreLote = (t: string) => String(t || "").replace(/^Lote Subasta:\s*/i, "");
export const estrellasFijas = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
