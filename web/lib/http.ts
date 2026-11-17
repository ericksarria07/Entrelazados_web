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

// Ruta pública de consulta: si algo falla, la página recibe `respaldo` (p. ej. una
// lista vacía) con 500 en lugar de un error, y el detalle queda en el log.
export function conRespaldo<C = unknown>(respaldo: unknown, manejador: Manejador<C>): Manejador<C> {
  return ruta(async (req, contexto) => {
    try {
      return await manejador(req, contexto);
    } catch (err) {
      if (err instanceof ErrorHttp) throw err;
      console.error(`❌ Error en ${req.method} ${new URL(req.url).pathname}:`, (err as Error).message);
      return json(respaldo, 500);
    }
  });
}

export type Formulario = { campos: Record<string, unknown>; archivos: File[] };

// Cuerpo con posibles archivos: multipart/form-data (campo "fotos") o, si no, JSON o
// urlencoded como leerCuerpo. Un campo repetido llega como lista.
export async function leerFormulario(req: Request, campoArchivos = "fotos"): Promise<Formulario> {
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return { campos: await leerCuerpo(req), archivos: [] };
  }
  let datos: FormData;
  try {
    datos = await req.formData();
  } catch {
    throw new ErrorHttp(400, "No se pudieron recibir las fotos.");
  }
  const campos: Record<string, unknown> = {};
  const archivos: File[] = [];
  for (const [clave, valor] of datos.entries()) {
    if (typeof valor !== "string") {
      if (clave === campoArchivos) archivos.push(valor);
      continue;
    }
    if (clave in campos) campos[clave] = ([] as unknown[]).concat(campos[clave], valor);
    else campos[clave] = valor;
  }
  return { campos, archivos };
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
