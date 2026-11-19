// GET /api/sesion: datos de quien tiene la sesión abierta (cookie o Bearer), o 401.
// Las páginas lo usan para saber quién entró sin leer el token (la cookie es httpOnly).
import { ErrorHttp, json, ruta } from "@/lib/http";
import { datosDeSesion, exigirSesion } from "@/lib/sesion";

export const GET = ruta(async (req) => {
  const datos = await datosDeSesion(await exigirSesion(req));
  if (!datos) throw new ErrorHttp(401, "La cuenta ya no existe. Inicia sesión nuevamente.");
  const { id, nombre, rol, email, departamento, estado, esAdmin } = datos;
  return json({ id, nombre, rol, email, departamento, estado, esAdmin });
});
