// ==========================================================================
// CONFIGURACIÓN (equivale a backend/entrelazados-api/config.js)
//
// Nada se exige al importar: el build de Next.js no tiene los secretos.
// Cada valor se lee cuando una ruta lo necesita.
//   JWT_SECRET        firma de las sesiones (obligatoria)
//   APP_URL           dirección pública para los enlaces de los correos (opcional)
//   VERIFICAR_CORREO  '1' siempre, '0' nunca, '' solo si el correo está configurado
//   EMAIL_USER / EMAIL_PASS / EMAIL_HOST / EMAIL_PORT   ver lib/correo.ts
// ==========================================================================
import { correoConfigurado } from "@/lib/correo";

const texto = (nombre: string) => (process.env[nombre] ?? "").trim();

// Duración de la sesión (JWT y cookie): 8 horas, en segundos
export const duracionSesion = 8 * 60 * 60;
export const rondasBcrypt = 10;

export function jwtSecreto(): string {
  const secreto = texto("JWT_SECRET");
  if (!secreto) throw new Error("Falta la variable JWT_SECRET");
  return secreto;
}

// Dirección pública del sitio para los enlaces de los correos.
// Sin APP_URL se usa la dirección con la que llegó la petición.
export function urlPublica(req: Request): string {
  const configurada = texto("APP_URL").replace(/\/+$/, "");
  if (configurada) return configurada;
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return new URL(req.url).origin;
  const protocolo = h.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return `${protocolo}://${host}`;
}

// Dirección del sitio para lo que se arma sin una petición a mano: metadataBase (enlaces
// absolutos de Open Graph), el sitemap y robots.txt. APP_URL en producción; en Vercel, el
// dominio de producción o el de la vista previa; en local, localhost.
export function urlDelSitio(): string {
  const configurada = texto("APP_URL").replace(/\/+$/, "");
  if (configurada) return configurada;
  const vercel = texto(texto("VERCEL_ENV") === "production" ? "VERCEL_PROJECT_PRODUCTION_URL" : "VERCEL_URL");
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

export function verificarCorreo(): boolean {
  const modo = texto("VERIFICAR_CORREO");
  return modo === "1" || (modo !== "0" && correoConfigurado());
}
