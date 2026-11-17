// GET /api/ping: ¿el servidor responde? (de rutas/publicas.js)
import { json, ruta } from "@/lib/http";

export const GET = ruta(async () => json({ status: "ok", message: "API de EntreLazados operando." }));
