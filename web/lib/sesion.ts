// ==========================================================================
// SESIÓN Y PERMISOS (equivale a middlewares/autenticacion.js)
//
// El token JWT se entrega en /api/login y el navegador lo envía como
// "Authorization: Bearer <token>" (public/sesion.js). Después se consulta la base
// para tener el rol y el estado ACTUALES: si el admin suspende o elimina la
// cuenta, el token deja de servir al instante.
//
//   const usuario = await exigirSesion(req);          // { id, rol, esAdmin }
//   exigirRoles(usuario, 'proveedor');                // el admin siempre pasa
//   const admin = await exigirAdmin(req);
// ==========================================================================
import jwt from "jsonwebtoken";
import { duracionSesion, jwtSecreto } from "@/lib/config";
import { obtenerPool } from "@/lib/db";
import { ErrorHttp } from "@/lib/http";

export type Usuario = { id: number; rol: string; esAdmin: boolean };

export const esRolAdmin = (rol: string) => rol === "administrador" || rol === "admin";

export function firmarToken(usuario: { usuario_id: number; tipo_rol: string }): string {
  return jwt.sign({ id: usuario.usuario_id, rol: usuario.tipo_rol }, jwtSecreto(), { expiresIn: duracionSesion });
}

export async function exigirSesion(req: Request): Promise<Usuario> {
  const encabezado = req.headers.get("authorization") ?? "";
  const token = encabezado.startsWith("Bearer ") ? encabezado.slice(7) : null;
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

export function exigirRoles(usuario: Usuario, ...roles: string[]): void {
  if (usuario.esAdmin || roles.includes(usuario.rol)) return;
  throw new ErrorHttp(403, "Tu tipo de cuenta no tiene permiso para esta acción.");
}

export async function exigirAdmin(req: Request): Promise<Usuario> {
  const usuario = await exigirSesion(req);
  if (!usuario.esAdmin) throw new ErrorHttp(403, "Acceso denegado. Se requieren permisos de Administrador.");
  return usuario;
}
