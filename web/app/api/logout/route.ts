// POST /api/logout: cierra la sesión borrando la cookie httpOnly "sesion".
// No pide sesión: si ya venció, igual se borra la cookie. La página borra después sus datos
// guardados (localStorage), menos el tema.
import { cookies } from "next/headers";
import { json, ruta } from "@/lib/http";
import { COOKIE_SESION, opcionesCookieSesion } from "@/lib/sesion";

export const POST = ruta(async () => {
  (await cookies()).set(COOKIE_SESION, "", opcionesCookieSesion(0));
  return json({ ok: true, message: "Sesión cerrada." });
});
