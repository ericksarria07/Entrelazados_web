// Las notificaciones guardadas antes de la Fase 2 traen enlaces viejos ("mercado.html#tab-auctions"):
// se pasan a la ruta nueva ("/mercado#tab-auctions") para navegar sin la redirección.
const NOMBRES: Record<string, string> = { index: "/inicio", preview: "/" };

export function rutaNueva(enlace: string): string {
  const m = enlace.match(/^\/?([a-z-]+)\.html(.*)$/i);
  if (!m) return enlace.startsWith("/") || /^https?:/.test(enlace) ? enlace : "/" + enlace;
  return (NOMBRES[m[1]] ?? "/" + m[1]) + m[2];
}
