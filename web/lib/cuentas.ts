// ==========================================================================
// PIEZAS COMPARTIDAS POR LAS RUTAS DE CUENTAS
// (registro, login, recuperación de contraseña y confirmación del correo;
// antes todo en backend/entrelazados-api/rutas/cuentas.js)
// ==========================================================================
import crypto from "node:crypto";
import { enviarDespues, enviarVerificacion, correoConfigurado } from "@/lib/correo";

export const MENSAJE_RECUPERACION = "Si el correo está registrado, recibirás un enlace de recuperación en unos minutos.";
export const MENSAJE_REENVIO =
  "Si la cuenta existe y falta confirmarla, te enviamos un enlace nuevo. Revisa también la carpeta Spam.";
export const LARGO_MAXIMO_BCRYPT = 72; // bcrypt ignora lo que pase de 72 bytes
const ESPERA_REENVIO_MS = 60 * 1000; // 1 correo por minuto por dirección

export const nuevoToken = () => crypto.randomBytes(32).toString("hex");
export const esHashBcrypt = (hash: string) => /^\$2[aby]\$/.test(hash);

// Recuerda cuándo se mandó el último correo a cada dirección (1 por minuto).
// Devuelve false si todavía no pasó el minuto. En memoria, como los límites.
const ultimosEnvios = new Map<string, number>();
export function puedeEnviar(clave: string): boolean {
  const ahora = Date.now();
  const ultimo = ultimosEnvios.get(clave);
  if (ultimo !== undefined && ahora - ultimo < ESPERA_REENVIO_MS) return false;
  ultimosEnvios.set(clave, ahora);
  if (ultimosEnvios.size > 1000) {
    for (const [c, t] of ultimosEnvios) if (ahora - t > ESPERA_REENVIO_MS) ultimosEnvios.delete(c);
  }
  return true;
}

// Manda el enlace de confirmación (o lo escribe en el log si el correo no está configurado)
export function enviarEnlaceVerificacion(email: string, token: string, base: string) {
  const enlace = `${base}/verificar?token=${token}`;
  if (!correoConfigurado()) {
    console.warn(`✉️ Enlace para confirmar el correo de ${email} (correo no configurado): ${enlace}`);
    return;
  }
  enviarDespues("Correo de confirmación", email, () => enviarVerificacion(email, enlace));
}
