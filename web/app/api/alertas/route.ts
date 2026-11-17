// GET /api/alertas: mis alertas de búsqueda · POST: { palabraClave?, categoriaId?, precioMaximo? }
import { crearAlerta, listarAlertas } from "@/lib/favoritos";
import { json, leerCuerpo, ruta } from "@/lib/http";
import { exigirSesion } from "@/lib/sesion";

export const GET = ruta(async (req) => json(await listarAlertas((await exigirSesion(req)).id)));

export const POST = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  const alerta = await crearAlerta(usuario.id, await leerCuerpo(req));
  return json({ message: "Alerta creada: te avisaremos cuando publiquen algo así.", alerta }, 201);
});
