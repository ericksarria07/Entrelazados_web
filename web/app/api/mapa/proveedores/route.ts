// GET /api/mapa/proveedores?categoria=ID (con sesión) (de rutas/mapa.js)
// Agrupa a los proveedores activos por el departamento de su perfil y le pone a cada
// grupo las coordenadas de la cabecera departamental (lib/departamentos.ts). Con
// ?categoria= solo aparecen los que tienen publicaciones de esa categoría. Quienes
// escribieron un departamento que no se reconoce van en "sinUbicacion".
// No se envían correos ni teléfonos: para hablar con un proveedor está el chat.
import { obtenerPool } from "@/lib/db";
import { ubicarDepartamento } from "@/lib/departamentos";
import { json, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";
import { enteroPositivo, redondearCalificacion } from "@/lib/utilidades";

type Grupo = { departamento: string; lat: number; lng: number; proveedores: unknown[] };

export const GET = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  const categoria = enteroPositivo(new URL(req.url).searchParams.get("categoria"));
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT u.usuario_id, p.nombre_razon_social, prov.nombre_comercial, prov.tipo_materia_prima_principal,
            d.nombre_departamento,
            count(DISTINCT o.oferta_id)::int AS ofertas,
            string_agg(DISTINCT c.nombre_categoria, '|' ORDER BY c.nombre_categoria) AS categorias,
            cal.promedio, COALESCE(cal.total, 0) AS total_calificaciones
     FROM usuarios u
     JOIN perfiles_usuarios p ON p.usuario_id = u.usuario_id
     LEFT JOIN departamentos d ON d.departamento_id = p.departamento_id
     LEFT JOIN proveedores prov ON prov.usuario_id = u.usuario_id
     LEFT JOIN ofertas o ON o.proveedor_id = u.usuario_id ${categoria ? "AND o.categoria_id = $1" : ""}
     LEFT JOIN categorias_materiales c ON c.categoria_id = o.categoria_id
     LEFT JOIN (SELECT calificado_id, avg(puntuacion) AS promedio, count(*)::int AS total
                FROM calificaciones GROUP BY calificado_id) cal ON cal.calificado_id = u.usuario_id
     WHERE lower(u.tipo_rol) = 'proveedor' AND u.estado_cuenta = 'Activo'
     GROUP BY u.usuario_id, p.nombre_razon_social, prov.nombre_comercial, prov.tipo_materia_prima_principal,
              d.nombre_departamento, cal.promedio, cal.total
     ${categoria ? "HAVING count(DISTINCT o.oferta_id) > 0" : ""}
     ORDER BY ofertas DESC, p.nombre_razon_social`,
    categoria ? [categoria] : []
  );

  const grupos = new Map<string, Grupo>();
  const sinUbicacion = [];
  for (const f of rows) {
    const proveedor = {
      id: f.usuario_id,
      nombre: f.nombre_comercial || f.nombre_razon_social,
      razonSocial: f.nombre_razon_social,
      especialidad: f.tipo_materia_prima_principal || null,
      ofertas: f.ofertas,
      categorias: f.categorias ? String(f.categorias).split("|") : [],
      calificacion: redondearCalificacion(f.promedio),
      totalCalificaciones: Number(f.total_calificaciones),
      departamentoEscrito: f.nombre_departamento || null,
    };
    const ubicacion = ubicarDepartamento(f.nombre_departamento);
    if (!ubicacion) {
      sinUbicacion.push(proveedor);
      continue;
    }
    if (!grupos.has(ubicacion.nombre)) grupos.set(ubicacion.nombre, { departamento: ubicacion.nombre, lat: ubicacion.lat, lng: ubicacion.lng, proveedores: [] });
    grupos.get(ubicacion.nombre)!.proveedores.push(proveedor);
  }
  // Dónde está quien mira el mapa (para centrarlo y marcar "tu departamento")
  const {
    rows: [yo],
  } = await pool.query(
    `SELECT d.nombre_departamento FROM perfiles_usuarios p
     LEFT JOIN departamentos d ON d.departamento_id = p.departamento_id WHERE p.usuario_id = $1`,
    [usuario.id]
  );
  const departamentos = [...grupos.values()].sort((a, b) => b.proveedores.length - a.proveedores.length);
  return json({ total: rows.length, departamentos, sinUbicacion, miUbicacion: yo ? ubicarDepartamento(yo.nombre_departamento) : null });
});
