// POST /api/logout: cierra la sesión borrando la cookie httpOnly "sesion". Además sube la
// versión de la sesión: el token deja de servir aunque alguien lo haya copiado, y se
// cierran las sesiones de la misma cuenta en los demás dispositivos.
// No pide sesión: si ya venció, igual se borra la cookie. La página borra después sus datos
// guardados (localStorage), menos el tema.
import { cookies } from "next/headers";
import { json, ruta } from "@/lib/http";
import { COOKIE_SESION, cerrarSesiones, opcionesCookieSesion, tokenDe } from "@/lib/sesion";

export const POST = ruta(async (req) => {
  await cerrarSesiones(tokenDe(req));
  (await cookies()).set(COOKIE_SESION, "", opcionesCookieSesion(0));
  return json({ ok: true, message: "Sesión cerrada." });
});
