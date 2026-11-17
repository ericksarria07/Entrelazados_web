// GET /api/chat/contactos: personas con quien conversar (de rutas/chat.js).
// Se excluye al propio usuario. Primero los que tienen mensajes sin leer, luego las
// conversaciones más recientes.
import { obtenerPool } from "@/lib/db";
import { conRespaldo, json } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";

export const GET = conRespaldo([], async (req) => {
  const yo = (await exigirSesion(req)).id;
  const { rows } = await obtenerPool().query(
    `SELECT * FROM (
     SELECT p.usuario_id AS "UsuarioID", p.nombre_razon_social AS "NombreRazonSocial",
            COALESCE(u.tipo_rol, 'Usuario') AS "TipoRol",
            COALESCE(d.nombre_departamento, 'Nicaragua') AS "NombreDepartamento",
            (SELECT count(*)::int FROM mensajes_chat m
              WHERE m.remitente_id = p.usuario_id AND m.destinatario_id = $1 AND m.es_leido = false) AS "NoLeidos",
            (SELECT max(m.fecha_envio) FROM mensajes_chat m
              WHERE (m.remitente_id = p.usuario_id AND m.destinatario_id = $1)
                 OR (m.remitente_id = $1 AND m.destinatario_id = p.usuario_id)) AS "UltimoMensaje"
     FROM perfiles_usuarios p
     LEFT JOIN usuarios u ON p.usuario_id = u.usuario_id
     LEFT JOIN departamentos d ON p.departamento_id = d.departamento_id
     WHERE p.usuario_id <> $1
     ) c
     ORDER BY "NoLeidos" > 0 DESC, "UltimoMensaje" IS NULL, "UltimoMensaje" DESC, "NombreRazonSocial"`,
    [yo]
  );
  return json(rows);
});
