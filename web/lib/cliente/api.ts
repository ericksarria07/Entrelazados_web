// ==========================================================================
// PETICIONES A LA API DESDE LAS PÁGINAS (lo que hacía el fetch de sesion.js)
//
// La cookie de sesión va sola. Si una ruta responde 401 (sesión vencida o la cuenta
// ya no existe), se cierra la sesión y se vuelve a /login, igual que antes.
//   const res = await api(`/api/ofertas?${filtros}`);
//   const datos = await apiJSON<Oferta[]>("/api/categorias");
// ==========================================================================
import { cerrarSesion } from "./sesion";

let cerrando = false;

export async function api(url: string, opciones?: RequestInit): Promise<Response> {
  const res = await fetch(url, opciones);
  if (res.status === 401 && !url.startsWith("/api/login") && !cerrando) {
    cerrando = true;
    await cerrarSesion();
    alert("Tu sesión expiró. Por favor inicia sesión nuevamente.");
    window.location.href = new URL("/login", window.location.origin).href;
  }
  return res;
}

// JSON de la respuesta; si la ruta falla, lanza un Error con su mensaje
export async function apiJSON<T>(url: string, opciones?: RequestInit): Promise<T> {
  const res = await api(url, opciones);
  let datos: unknown = null;
  try {
    datos = await res.json();
  } catch {
    /* sin cuerpo */
  }
  if (!res.ok) {
    const d = (datos ?? {}) as { error?: string; message?: string };
    throw new Error(d.error || d.message || `Error ${res.status}`);
  }
  return datos as T;
}

// POST/PUT/DELETE con cuerpo JSON
export const conJSON = (method: string, cuerpo?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
});

// Mensaje de error de una respuesta fallida
export async function mensajeDeError(res: Response, porDefecto = "Ocurrió un error."): Promise<string> {
  try {
    const d = (await res.json()) as { error?: string; message?: string };
    return d.error || d.message || porDefecto;
  } catch {
    return porDefecto;
  }
}
