// Lo que se manda a Vercel Web Analytics y Speed Insights: la dirección de la página,
// sin los parámetros con datos privados. /verificar?token=... y /restablecer?token=...
// llevan el token de un solo uso en la URL; no debe quedar en los registros de visitas.
const PARAMETROS_PRIVADOS = ["token"];

export function sinDatosPrivados(url: string): string {
  try {
    const u = new URL(url);
    let cambio = false;
    for (const nombre of PARAMETROS_PRIVADOS) {
      if (u.searchParams.has(nombre)) {
        u.searchParams.delete(nombre);
        cambio = true;
      }
    }
    return cambio ? u.toString() : url;
  } catch {
    return url;
  }
}
