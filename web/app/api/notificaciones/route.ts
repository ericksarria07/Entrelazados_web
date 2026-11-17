// GET /api/notificaciones: las últimas 30 y cuántas faltan por leer (de rutas/notificaciones.js)
import { json, ruta } from "@/lib/http";
import { listarNotificaciones } from "@/lib/notificaciones";
import { exigirSesion } from "@/lib/sesion";

export const GET = ruta(async (req) => json(await listarNotificaciones((await exigirSesion(req)).id)));
