// POST /api/admin/categorias { nombreCategoria, descripcion? }: crear una categoría (de rutas/admin.js)
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { exigirAdmin } from "@/lib/sesion";
import { textoLimpio } from "@/lib/utilidades";

export const POST = ruta(async (req) => {
  await exigirAdmin(req);
  const b = await leerCuerpo(req);
  const nombre = textoLimpio(b.nombreCategoria);
  if (!nombre) throw new ErrorHttp(400, "El nombre de la categoría es obligatorio.");
  try {
    const {
      rows: [nueva],
    } = await obtenerPool().query(
      "INSERT INTO categorias_materiales (nombre_categoria, descripcion) VALUES ($1, $2) RETURNING categoria_id",
      [nombre, b.descripcion || null]
    );
    return json({ success: true, id: nueva.categoria_id, message: `Categoría '${nombre}' creada exitosamente.` });
  } catch (err) {
    console.error("❌ Error al crear categoría:", (err as Error).message);
    throw new ErrorHttp(500, "Error al registrar la nueva categoría o ya existe.");
  }
});
