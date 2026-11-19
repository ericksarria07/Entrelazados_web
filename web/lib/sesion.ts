// ==========================================================================
// SESIÓN Y PERMISOS (equivale a middlewares/autenticacion.js)
//
// POST /api/login firma un JWT de 8 h y lo guarda en la cookie httpOnly "sesion"
// (JavaScript de la página no puede leerla). El navegador la manda sola en cada
// petición al mismo sitio. Las pruebas, Swagger y otros clientes pueden mandar el
// mismo token como "Authorization: Bearer <token>".
// Después se consulta la base para tener el rol y el estado ACTUALES: si el admin
// suspende o elimina la cuenta, la sesión deja de servir al instante.
//
//   const usuario = await exigirSesion(req);          // { id, rol, esAdmin }
//   exigirRoles(usuario, 'proveedor');                // el admin siempre pasa
//   const admin = await exigirAdmin(req);
//   const usuario = await leerSesionDesdeCookies();   // Server Components: Usuario | null
//   const datos = await datosDeSesionDesdeCookies();  // páginas: nombre, correo, departamento...
// ==========================================================================
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { cache } from "react";
import { duracionSesion, jwtSecreto } from "@/lib/config";
import { obtenerPool } from "@/lib/db";
import { ErrorHttp } from "@/lib/http";

export type Usuario = { id: number; rol: string; esAdmin: boolean };

export const COOKIE_SESION = "sesion";

export const esRolAdmin = (rol: string) => rol === "administrador" || rol === "admin";

export function firmarToken(usuario: { usuario_id: number; tipo_rol: string }): string {
  return jwt.sign({ id: usuario.usuario_id, rol: usuario.tipo_rol }, jwtSecreto(), { expiresIn: duracionSesion });
}

// Opciones de la cookie de sesión. En `next dev` (http://localhost) va sin Secure.
export function opcionesCookieSesion(maxAge = duracionSesion) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// Inicio y vencimiento (segundos desde 1970) de un token recién firmado: la página los
// guarda para saber cuándo vence la sesión sin poder leer la cookie.
export function fechasDelToken(token: string): { inicio: number; vence: number } {
  const datos = jwt.decode(token) as jwt.JwtPayload | null;
  return { inicio: datos?.iat ?? 0, vence: datos?.exp ?? 0 };
}

function leerCookie(req: Request, nombre: string): string | null {
  for (const parte of (req.headers.get("cookie") ?? "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

// Token de la petición: "Authorization: Bearer" (si trae algo) o, si no, la cookie.
function tokenDe(req: Request): string | null {
  const encabezado = req.headers.get("authorization") ?? "";
  const bearer = encabezado.startsWith("Bearer ") ? encabezado.slice(7).trim() : "";
  return bearer || leerCookie(req, COOKIE_SESION) || null;
}

// ¿La petición trae alguna credencial? (para rutas donde la sesión es opcional)
export const traeSesion = (req: Request) => tokenDe(req) !== null;

async function usuarioDelToken(token: string | null): Promise<Usuario> {
  if (!token) throw new ErrorHttp(401, "Debes iniciar sesión para continuar.");

  let usuarioId: unknown;
  try {
    usuarioId = (jwt.verify(token, jwtSecreto()) as jwt.JwtPayload).id;
  } catch {
    throw new ErrorHttp(401, "Tu sesión expiró o no es válida. Inicia sesión nuevamente.");
  }

  type Fila = { usuario_id: number; tipo_rol: string | null; estado_cuenta: string | null };
  let usuario: Fila | undefined;
  try {
    ({
      rows: [usuario],
    } = await obtenerPool().query<Fila>("SELECT usuario_id, tipo_rol, estado_cuenta FROM usuarios WHERE usuario_id = $1", [
      usuarioId,
    ]));
  } catch (err) {
    console.error("❌ Error al verificar la sesión:", (err as Error).message);
    throw new ErrorHttp(500, "Error al verificar la sesión.");
  }
  if (!usuario) throw new ErrorHttp(401, "La cuenta ya no existe. Inicia sesión nuevamente.");
  if ((usuario.estado_cuenta ?? "").toLowerCase() === "suspendido") {
    throw new ErrorHttp(403, "Tu cuenta ha sido suspendida por el administrador.");
  }
  const rol = (usuario.tipo_rol ?? "").toLowerCase();
  return { id: usuario.usuario_id, rol, esAdmin: esRolAdmin(rol) };
}

export async function exigirSesion(req: Request): Promise<Usuario> {
  return usuarioDelToken(tokenDe(req));
}

// Para Server Components y Server Functions: el usuario de la cookie, o null si no hay
// sesión válida (vencida, cuenta suspendida o eliminada). Con Cache Components, quien
// la use debe ir dentro de <Suspense>.
export async function leerSesionDesdeCookies(): Promise<Usuario | null> {
  const token = (await cookies()).get(COOKIE_SESION)?.value ?? null;
  if (!token) return null;
  try {
    return await usuarioDelToken(token);
  } catch (err) {
    if (err instanceof ErrorHttp && err.status < 500) return null;
    throw err;
  }
}

// Lo que una página necesita saber de quien entró (lo mismo que GET /api/sesion)
export type DatosSesion = {
  id: number;
  nombre: string;
  rol: string;
  email: string;
  departamento: string;
  estado: string;
  esAdmin: boolean;
  // Inicio y vencimiento del token (segundos): la memoria de Kan se ata al inicio
  inicio: number;
  vence: number;
};

export async function datosDeSesion(usuario: Usuario, token?: string | null): Promise<DatosSesion | null> {
  const {
    rows: [fila],
  } = await obtenerPool().query(
    `SELECT u.usuario_id, u.tipo_rol, u.estado_cuenta, u.correo_electronico,
            p.nombre_razon_social, d.nombre_departamento
     FROM usuarios u
     LEFT JOIN perfiles_usuarios p ON u.usuario_id = p.usuario_id
     LEFT JOIN departamentos d ON p.departamento_id = d.departamento_id
     WHERE u.usuario_id = $1`,
    [usuario.id]
  );
  if (!fila) return null;
  const { inicio, vence } = token ? fechasDelToken(token) : { inicio: 0, vence: 0 };
  return {
    id: fila.usuario_id,
    nombre: fila.nombre_razon_social || "Usuario",
    rol: fila.tipo_rol,
    email: fila.correo_electronico,
    departamento: fila.nombre_departamento || "Managua",
    estado: fila.estado_cuenta || "Activo",
    esAdmin: usuario.esAdmin,
    inicio,
    vence,
  };
}

// Páginas (Server Components): los datos de quien entró, o null si no hay sesión válida.
// Lee la cookie: con Cache Components va dentro de <Suspense>. cache(): el layout y la
// página que lo pidan en la misma petición comparten una sola consulta.
export const datosDeSesionDesdeCookies = cache(async (): Promise<DatosSesion | null> => {
  const token = (await cookies()).get(COOKIE_SESION)?.value ?? null;
  const usuario = await leerSesionDesdeCookies();
  return usuario ? datosDeSesion(usuario, token) : null;
});

export function exigirRoles(usuario: Usuario, ...roles: string[]): void {
  if (usuario.esAdmin || roles.includes(usuario.rol)) return;
  throw new ErrorHttp(403, "Tu tipo de cuenta no tiene permiso para esta acción.");
}

export async function exigirAdmin(req: Request): Promise<Usuario> {
  const usuario = await exigirSesion(req);
  if (!usuario.esAdmin) throw new ErrorHttp(403, "Acceso denegado. Se requieren permisos de Administrador.");
  return usuario;
}
