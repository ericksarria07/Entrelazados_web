// POST /api/reenviar-verificacion: manda otro enlace de confirmación (el anterior deja de servir).
// Responde siempre lo mismo para no revelar qué correos existen.
import { urlPublica } from "@/lib/config";
import { MENSAJE_REENVIO, enviarEnlaceVerificacion, hashToken, nuevoToken, puedeEnviar } from "@/lib/cuentas";
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { ipDe, limite } from "@/lib/limites";
import { REGEX_EMAIL, textoLimpio } from "@/lib/utilidades";

export const POST = ruta(async (req) => {
  await limite("recuperacion", ipDe(req)).consumir();
  const emailLimpio = textoLimpio((await leerCuerpo(req)).email);
  if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
    throw new ErrorHttp(400, "Ingresa un correo electrónico válido.");
  }
  const respuesta = json({ message: MENSAJE_REENVIO });
  if (!(await puedeEnviar("verificar:" + emailLimpio.toLowerCase()))) return respuesta;

  const pool = obtenerPool();
  const {
    rows: [usuario],
  } = await pool.query(
    "SELECT usuario_id, correo_electronico FROM usuarios WHERE correo_electronico = $1 AND correo_verificado = false",
    [emailLimpio]
  );
  if (!usuario) return respuesta;

  const token = nuevoToken();
  await pool.query(
    "UPDATE usuarios SET token_verificacion = $1, expiracion_verificacion = now() + interval '24 hours' WHERE usuario_id = $2",
    [hashToken(token), usuario.usuario_id]
  );
  enviarEnlaceVerificacion(usuario.correo_electronico, token, urlPublica(req));
  return respuesta;
});
