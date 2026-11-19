// ==========================================================================
// SESIÓN EN EL NAVEGADOR (páginas React)
//
// La sesión de verdad es la cookie httpOnly "sesion" (no se puede leer desde aquí).
// Las páginas con sesión reciben los datos del servidor (ProveedorSitio). En
// localStorage quedan los que guardaba login.html, que no son secretos: con ellos
// /login sabe si ya hay sesión y Kan ata su memoria a la sesión.
// ==========================================================================

export type DatosLogin = {
  id: number;
  nombre: string;
  rol: string;
  departamento?: string;
  sesion?: { inicio: number; vence: number };
};

export const esRolAdmin = (rol: string | null | undefined) => {
  const r = (rol ?? "").toLowerCase();
  return r === "administrador" || r === "admin";
};

// Página de inicio según el rol (igual que login.html)
export const inicioSegunRol = (rol: string | null | undefined) => (esRolAdmin(rol) ? "/admin" : "/inicio");

export function guardarSesion(email: string, d: DatosLogin) {
  try {
    localStorage.setItem("userEmail", email);
    localStorage.setItem("userNombre", d.nombre);
    localStorage.setItem("userRol", d.rol);
    localStorage.setItem("userId", String(d.id));
    localStorage.setItem("userDepartamento", d.departamento || "Managua");
    localStorage.setItem("sesionInicio", String(d.sesion?.inicio ?? ""));
    localStorage.setItem("sesionVence", String(d.sesion?.vence ?? ""));
  } catch {
    /* almacenamiento bloqueado: la cookie igual sirve */
  }
}

// Quién entró según lo guardado (null si no hay sesión en este navegador)
export function sesionGuardada(): { id: string; rol: string } | null {
  try {
    const id = localStorage.getItem("userId");
    return id ? { id, rol: localStorage.getItem("userRol") ?? "" } : null;
  } catch {
    return null;
  }
}

// Cierra la sesión: borra la cookie en el servidor y lo guardado, menos el tema
export async function cerrarSesion() {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  try {
    const tema = localStorage.getItem("entrelazados-tema");
    localStorage.clear();
    if (tema) localStorage.setItem("entrelazados-tema", tema);
  } catch {
    /* nada que borrar */
  }
}

export const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// JSON de una respuesta, o {} si no trae
export async function leerJSON<T = Record<string, unknown>>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}
