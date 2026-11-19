// GET /api/sesion: datos de quien tiene la sesión abierta (cookie o Bearer), o 401.
// Las páginas lo usan para saber quién entró sin leer el token (la cookie es httpOnly).
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";

export const GET = ruta(async (req) => {
  const usuario = await exigirSesion(req);
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
  if (!fila) throw new ErrorHttp(401, "La cuenta ya no existe. Inicia sesión nuevamente.");
  return json({
    id: fila.usuario_id,
    nombre: fila.nombre_razon_social || "Usuario",
    rol: fila.tipo_rol,
    email: fila.correo_electronico,
    departamento: fila.nombre_departamento || "Managua",
    estado: fila.estado_cuenta || "Activo",
    esAdmin: usuario.esAdmin,
  });
});
