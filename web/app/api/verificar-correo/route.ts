// GET /api/verificar-correo?token=: confirma el correo con el enlace que llegó al registrarse.
// Cada enlace sirve una sola vez y vence en 24 horas.
import { obtenerPool } from "@/lib/db";
import { json, ruta } from "@/lib/http";
import { esTokenValido } from "@/lib/utilidades";

const INVALIDO = { ok: false, message: "El enlace no es válido o ya venció. Inicia sesión y pide uno nuevo." };

export const GET = ruta(async (req) => {
  const token = new URL(req.url).searchParams.get("token");
  if (!esTokenValido(token)) return json(INVALIDO, 400);
  const { rowCount } = await obtenerPool().query(
    `UPDATE usuarios SET correo_verificado = true, token_verificacion = NULL, expiracion_verificacion = NULL
     WHERE token_verificacion = $1 AND expiracion_verificacion > now()`,
    [token]
  );
  if (!rowCount) return json(INVALIDO, 400);
  return json({ ok: true, message: "¡Listo! Tu correo quedó confirmado. Ya puedes iniciar sesión." });
});
