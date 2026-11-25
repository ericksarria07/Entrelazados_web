// POST /api/solicitar-recuperacion: manda el enlace para elegir otra contraseña (vale 1 hora).
// Siempre responde lo mismo, exista o no la cuenta, para no revelar qué correos están registrados.
import { urlPublica } from "@/lib/config";
import { correoConfigurado, enviarDespues, enviarRecuperacion } from "@/lib/correo";
import { MENSAJE_RECUPERACION, hashToken, nuevoToken, puedeEnviar } from "@/lib/cuentas";
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { ipDe, limite } from "@/lib/limites";
import { REGEX_EMAIL, textoLimpio } from "@/lib/utilidades";

export const POST = ruta(async (req) => {
  await limite("recuperacion", ipDe(req)).consumir();
  const emailLimpio = textoLimpio((await leerCuerpo(req)).email);
  if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
    throw new ErrorHttp(400, "Por favor proporciona un correo electrónico válido.");
  }
  const respuesta = json({ message: MENSAJE_RECUPERACION });
  if (!(await puedeEnviar(emailLimpio.toLowerCase()))) return respuesta;

  const pool = obtenerPool();
  const {
    rows: [usuario],
  } = await pool.query(
    "SELECT usuario_id, correo_electronico FROM usuarios WHERE correo_electronico = $1 AND (estado_cuenta IS NULL OR estado_cuenta <> 'Suspendido')",
    [emailLimpio]
  );
  if (!usuario) return respuesta;

  const token = nuevoToken();
  await pool.query(
    "UPDATE usuarios SET token_recuperacion = $1, expiracion_token = now() + interval '1 hour' WHERE usuario_id = $2",
    [hashToken(token), usuario.usuario_id]
  );

  const base = urlPublica(req);
  const enlace = `${base}/restablecer?token=${token}`;
  if (!correoConfigurado()) {
    console.warn(`🔑 Enlace de recuperación para ${emailLimpio} (correo no configurado): ${enlace}`);
  } else {
    enviarDespues("Correo de recuperación", emailLimpio, () =>
      enviarRecuperacion(usuario.correo_electronico, enlace, base)
    );
  }
  return respuesta;
});
