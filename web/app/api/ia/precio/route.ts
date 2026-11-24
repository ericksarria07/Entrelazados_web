// POST /api/ia/precio (proveedores): { titulo?, categoriaId, unidad?, ofertaId? }
// -> { sugerido, rango, explicacion, fuente, ejemplos... }. Sin Gemini sugiere la mediana.
import { sugerirPrecio } from "@/lib/asistente-ia";
import { json, leerCuerpo, ruta } from "@/lib/http";
import { limite } from "@/lib/limites";
import { exigirRoles, exigirSesion } from "@/lib/sesion";

export const POST = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  exigirRoles(usuario, "proveedor");
  await limite("ia", `u${usuario.id}`).consumir();
  return json(await sugerirPrecio(await leerCuerpo(req)));
});
