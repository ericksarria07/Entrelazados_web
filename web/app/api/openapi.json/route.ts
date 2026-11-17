// GET /api/openapi.json: la especificación en crudo (para Postman, Insomnia...)
import { leerEspecificacion } from "@/lib/documentacion";
import { json, ruta } from "@/lib/http";

export const GET = ruta(async () => json(leerEspecificacion()));
