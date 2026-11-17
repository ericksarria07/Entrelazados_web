// GET /api/favoritos/ids: solo los números de mis favoritos (para pintar los corazones)
import { idsFavoritos } from "@/lib/favoritos";
import { json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";

export const GET = ruta(async (req) => json(await idsFavoritos((await exigirSesion(req)).id)));
