// GET /api/tiempo-real/token: permiso de Ably para que la página escuche los avisos.
// Con sesión cubre el canal público y el propio; sin sesión, solo el público.
// Con una sesión inválida o de una cuenta suspendida responde 401/403 (como el resto de la API).
// Sin ABLY_API_KEY responde 503: la página sigue preguntando cada cierto tiempo, como antes.
import { ErrorHttp, json, ruta } from "@/lib/http";
import { exigirSesion, traeSesion } from "@/lib/sesion";
import { tokenParaNavegador } from "@/lib/tiempo-real";

export const GET = ruta(async (req) => {
  const usuario = traeSesion(req) ? await exigirSesion(req) : null;
  const permiso = await tokenParaNavegador(usuario?.id ?? null);
  if (!permiso) throw new ErrorHttp(503, "El tiempo real no está configurado.");
  return json(permiso);
});
