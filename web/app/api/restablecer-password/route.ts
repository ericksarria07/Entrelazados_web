// POST /api/restablecer-password: guarda la contraseña nueva con el token del enlace.
// Abrir el enlace que llegó al correo demuestra que el correo es suyo: también lo confirma.
// También cierra las sesiones que estaban abiertas (version_sesion + 1, ver lib/sesion.ts).
import bcrypt from "bcryptjs";
import { rondasBcrypt } from "@/lib/config";
import { LARGO_MAXIMO_BCRYPT, LARGO_MINIMO_CONTRASENA, hashToken } from "@/lib/cuentas";
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { ipDe, limite } from "@/lib/limites";

export const POST = ruta(async (req) => {
  await limite("recuperacion", ipDe(req)).consumir();
  const { token, nuevaContrasena } = await leerCuerpo(req);
  if (!token || !nuevaContrasena) {
    throw new ErrorHttp(400, "Datos incompletos para restablecer la contraseña.");
  }
  if (typeof token !== "string" || typeof nuevaContrasena !== "string" || nuevaContrasena.length < LARGO_MINIMO_CONTRASENA) {
    throw new ErrorHttp(400, `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`);
  }
  if (Buffer.byteLength(nuevaContrasena, "utf8") > LARGO_MAXIMO_BCRYPT) {
    throw new ErrorHttp(400, "La contraseña es demasiado larga (máximo 72 caracteres).");
  }

  const pool = obtenerPool();
  const {
    rows: [usuario],
  } = await pool.query("SELECT usuario_id FROM usuarios WHERE token_recuperacion = $1 AND expiracion_token > now()", [
    hashToken(token),
  ]);
  if (!usuario) throw new ErrorHttp(400, "El token de recuperación es inválido o ha expirado.");

  await pool.query(
    `UPDATE usuarios
     SET contrasena_hash = $1, token_recuperacion = NULL, expiracion_token = NULL,
         correo_verificado = true, token_verificacion = NULL, expiracion_verificacion = NULL,
         version_sesion = version_sesion + 1
     WHERE usuario_id = $2`,
    [await bcrypt.hash(nuevaContrasena, rondasBcrypt), usuario.usuario_id]
  );
  return json({ message: "¡Contraseña actualizada con éxito! Ahora puedes iniciar sesión." });
});
