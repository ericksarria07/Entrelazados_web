// ==========================================================================
// PERFILES Y REPUTACIÓN: piezas compartidas (de rutas/usuarios.js y servicios/tratos.js)
// El perfil público nunca trae correo, teléfono, dirección ni RUC. Solo existe para
// proveedores y emprendedores con la cuenta activa (a cualquier otro se le responde 404).
// ==========================================================================
import { obtenerPool } from "@/lib/db";
import { ErrorHttp } from "@/lib/http";
import { enteroPositivo, redondearCalificacion } from "@/lib/utilidades";

const NO_ENCONTRADO = "Ese perfil no existe o no está disponible.";

export type UsuarioPublico = {
  usuario_id: number;
  tipo_rol: string;
  fecha_registro: Date;
  nombre_razon_social: string | null;
  nombre_departamento: string | null;
  nombre_comercial: string | null;
  descripcion_empresa: string | null;
  tipo_materia_prima_principal: string | null;
  nombre_marca: string | null;
  especialidad_calzado: string | null;
};

// Proveedor o emprendedor con la cuenta activa; si no, 404 (no se dice si existe)
export async function usuarioPublico(id: unknown): Promise<UsuarioPublico> {
  const usuarioId = enteroPositivo(id);
  if (!usuarioId) throw new ErrorHttp(404, NO_ENCONTRADO);
  const {
    rows: [u],
  } = await obtenerPool().query<UsuarioPublico>(
    `SELECT u.usuario_id, u.tipo_rol, u.fecha_registro, p.nombre_razon_social, d.nombre_departamento,
            prov.nombre_comercial, prov.descripcion_empresa, prov.tipo_materia_prima_principal,
            emp.nombre_marca, emp.especialidad_calzado
     FROM usuarios u
     LEFT JOIN perfiles_usuarios p ON p.usuario_id = u.usuario_id
     LEFT JOIN departamentos d ON d.departamento_id = p.departamento_id
     LEFT JOIN proveedores prov ON prov.usuario_id = u.usuario_id
     LEFT JOIN emprendedores emp ON emp.usuario_id = u.usuario_id
     WHERE u.usuario_id = $1 AND u.estado_cuenta = 'Activo'
       AND lower(u.tipo_rol) IN ('proveedor', 'emprendedor')
     LIMIT 1`,
    [usuarioId]
  );
  if (!u) throw new ErrorHttp(404, NO_ENCONTRADO);
  return u;
}

// Promedio, total y últimas 5 calificaciones recibidas (de servicios/tratos.js)
export async function reputacion(usuarioId: number) {
  const pool = obtenerPool();
  const [
    {
      rows: [resumen],
    },
    { rows: ultimas },
  ] = await Promise.all([
    pool.query("SELECT count(*)::int AS total, avg(puntuacion) AS promedio FROM calificaciones WHERE calificado_id = $1", [usuarioId]),
    pool.query(
      `SELECT c.puntuacion, c.comentario, c.fecha_calificacion AS fecha, COALESCE(p.nombre_razon_social, 'Usuario') AS autor
       FROM calificaciones c LEFT JOIN perfiles_usuarios p ON p.usuario_id = c.autor_id
       WHERE c.calificado_id = $1
       ORDER BY c.fecha_calificacion DESC, c.calificacion_id DESC
       LIMIT 5`,
      [usuarioId]
    ),
  ]);
  const total = resumen.total as number;
  return { usuarioId, total, promedio: total ? redondearCalificacion(resumen.promedio) : null, ultimas };
}
