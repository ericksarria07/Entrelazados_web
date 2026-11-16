// ==========================================================================
// RESPUESTAS Y ERRORES DE LA API (equivale a middlewares/errores.js)
//
//   export const POST = ruta(async (req) => { ... return Response.json(...) });
//
// - ErrorHttp: error esperado, se responde { message, ...extra } con su código.
// - JSON mal formado: 400 "Formato de datos inválido."
// - Cualquier otro error: el detalle va al log y el usuario ve un 500 genérico
//   (nunca detalles de la base de datos).
// Todas las respuestas llevan Cache-Control: no-store.
// ==========================================================================
import { connection } from "next/server";

export class ErrorHttp extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

class ErrorFormato extends Error {}

const SIN_CACHE = { "Cache-Control": "no-store" };

export function json(datos: unknown, status = 200): Response {
  return Response.json(datos, { status, headers: SIN_CACHE });
}

type Manejador<C> = (req: Request, contexto: C) => Promise<Response>;

export function ruta<C = unknown>(manejador: Manejador<C>): Manejador<C> {
  return async (req, contexto) => {
    // Siempre en cada petición: nunca se prerenderiza ni se guarda en caché
    await connection();
    try {
      return await manejador(req, contexto);
    } catch (err) {
      if (err instanceof ErrorHttp) return json({ message: err.message, ...err.extra }, err.status);
      if (err instanceof ErrorFormato) return json({ message: "Formato de datos inválido." }, 400);
      const { pathname } = new URL(req.url);
      console.error(`❌ Error no controlado en ${req.method} ${pathname}:`, (err as Error).stack ?? err);
      return json({ message: "Error interno del servidor." }, 500);
    }
  };
}

// Cuerpo de la petición en JSON o como formulario (igual que express.json + urlencoded).
// Sin cuerpo devuelve {}.
export async function leerCuerpo(req: Request): Promise<Record<string, unknown>> {
  const tipo = req.headers.get("content-type") ?? "";
  const texto = await req.text();
  if (!texto) return {};
  if (tipo.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(texto));
  }
  try {
    const datos = JSON.parse(texto);
    return datos && typeof datos === "object" ? datos : {};
  } catch {
    throw new ErrorFormato();
  }
}
