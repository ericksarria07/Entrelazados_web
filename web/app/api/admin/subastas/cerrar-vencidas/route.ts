// POST /api/admin/subastas/cerrar-vencidas: cerrar ahora las subastas vencidas (de rutas/admin.js).
// Normalmente se cierran solas (cierre perezoso y la corrida de cada hora, ver lib/cierre-subastas.ts).
import { urlPublica } from "@/lib/config";
import { cerrarVencidas } from "@/lib/cierre-subastas";
import { json, ruta } from "@/lib/http";
import { exigirAdmin } from "@/lib/sesion";

export const POST = ruta(async (req) => {
  await exigirAdmin(req);
  const cerradas = await cerrarVencidas(urlPublica(req));
  return json({
    message: cerradas.length ? `Se cerraron ${cerradas.length} subasta(s) vencida(s).` : "No había subastas vencidas por cerrar.",
    cerradas,
  });
});
