// GET /api/perfil/[id]: perfil completo, el propio o cualquiera si eres admin (de rutas/usuarios.js)
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { enteroPositivo } from "@/lib/utilidades";

export const GET = ruta<RouteContext<"/api/perfil/[id]">>(async (req, ctx) => {
  const usuario = await exigirSesion(req);
  const usuarioId = Number((await ctx.params).id);
  // Cada usuario solo puede ver su propio perfil completo (correo, teléfono, RUC...)
  if (usuarioId !== usuario.id && !usuario.esAdmin) throw new ErrorHttp(403, "No tienes permiso para ver este perfil.");
  if (!enteroPositivo(usuarioId)) throw new ErrorHttp(404, "Usuario no encontrado.");
  const {
    rows: [perfil],
  } = await obtenerPool().query(
    `SELECT u.usuario_id AS "UsuarioID", u.correo_electronico AS "CorreoElectronico", u.tipo_rol AS "TipoRol",
            u.estado_cuenta AS "EstadoCuenta", p.nombre_razon_social AS "NombreRazonSocial",
            p.telefono_whatsapp AS "TelefonoWhatsApp", d.nombre_departamento AS "NombreDepartamento",
            prov.numero_ruc AS "NumeroRUC", prov.nombre_comercial AS "NombreComercial",
            prov.tipo_materia_prima_principal AS "TipoMateriaPrimaPrincipal", prov.descripcion_empresa AS "DescripcionEmpresa",
            emp.nombre_marca AS "NombreMarca", emp.especialidad_calzado AS "EspecialidadCalzado",
            emp.capacidad_produccion_mensual AS "CapacidadProduccionMensual", adm.nivel_acceso AS "NivelAcceso"
     FROM usuarios u
     LEFT JOIN perfiles_usuarios p ON u.usuario_id = p.usuario_id
     LEFT JOIN departamentos d ON p.departamento_id = d.departamento_id
     LEFT JOIN proveedores prov ON u.usuario_id = prov.usuario_id
     LEFT JOIN emprendedores emp ON u.usuario_id = emp.usuario_id
     LEFT JOIN administradores adm ON u.usuario_id = adm.usuario_id
     WHERE u.usuario_id = $1
     LIMIT 1`,
    [usuarioId]
  );
  if (!perfil) throw new ErrorHttp(404, "Usuario no encontrado.");
  return json(perfil);
});
