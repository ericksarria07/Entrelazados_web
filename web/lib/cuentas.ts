// ==========================================================================
// PIEZAS COMPARTIDAS POR LAS RUTAS DE CUENTAS
// (registro, login, recuperación de contraseña y confirmación del correo;
// antes todo en backend/entrelazados-api/rutas/cuentas.js)
// ==========================================================================
import crypto from "node:crypto";
import { enviarDespues, enviarVerificacion, correoConfigurado } from "@/lib/correo";
import { ErrorHttp } from "@/lib/http";
import { limite } from "@/lib/limites";

export const MENSAJE_RECUPERACION = "Si el correo está registrado, recibirás un enlace de recuperación en unos minutos.";
export const MENSAJE_REENVIO =
  "Si la cuenta existe y falta confirmarla, te enviamos un enlace nuevo. Revisa también la carpeta Spam.";
export const LARGO_MAXIMO_BCRYPT = 72; // bcrypt ignora lo que pase de 72 bytes
export const LARGO_MINIMO_CONTRASENA = 8;

export const nuevoToken = () => crypto.randomBytes(32).toString("hex");
// Los enlaces de recuperación y de confirmación llevan el token; la base guarda solo su
// SHA-256. Así, quien llegue a leer la base no puede usar los enlaces vigentes.
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
export const esHashBcrypt = (hash: string) => /^\$2[aby]\$/.test(hash);

// Un correo por minuto a cada dirección. Cuenta en la tabla limites_uso (como los
// límites de intentos), así vale para todas las instancias. false si todavía no pasó.
export async function puedeEnviar(clave: string): Promise<boolean> {
  try {
    await limite("correo", clave).consumir();
    return true;
  } catch (err) {
    if (err instanceof ErrorHttp && err.status === 429) return false;
    throw err;
  }
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
