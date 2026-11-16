// GET /api/validar-token-recuperacion?token=: restablecer.html pregunta, antes de que se
// escriba la contraseña, si el enlace sigue vigente.
import { obtenerPool } from "@/lib/db";
import { json, ruta } from "@/lib/http";
import { esTokenValido, ocultarCorreo } from "@/lib/utilidades";

export const GET = ruta(async (req) => {
  const token = new URL(req.url).searchParams.get("token");
  if (!esTokenValido(token)) return json({ valido: false }, 400);
  const {
    rows: [fila],
  } = await obtenerPool().query(
    "SELECT correo_electronico, expiracion_token FROM usuarios WHERE token_recuperacion = $1 AND expiracion_token > now()",
    [token]
  );
  if (!fila) return json({ valido: false }, 400);
  return json({ valido: true, correo: ocultarCorreo(fila.correo_electronico), expira: fila.expiracion_token });
});
