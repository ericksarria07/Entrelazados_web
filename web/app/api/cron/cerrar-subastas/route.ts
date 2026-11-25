// GET /api/cron/cerrar-subastas: la corrida de cada hora de Vercel Schedules (vercel.json,
// "cerrar-subastas") cierra las subastas vencidas que nadie miró y borra los contadores
// vencidos de los límites. Es un objetivo "path" (la ruta sigue siendo pública), así que
// Vercel manda "Authorization: Bearer <CRON_SECRET>"; sin CRON_SECRET configurado, la ruta
// no responde a nadie.
import { urlPublica } from "@/lib/config";
import { cerrarVencidas } from "@/lib/cierre-subastas";
import { json, ruta } from "@/lib/http";
import { limpiarLimitesVencidos } from "@/lib/limites";

export const GET = ruta(async (req) => {
  const secreto = (process.env.CRON_SECRET ?? "").trim();
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return json({ message: "No autorizado." }, 401);
  }
  const cerradas = await cerrarVencidas(urlPublica(req));
  const limitesBorrados = await limpiarLimitesVencidos();
  return json({ cerradas: cerradas.length, limitesBorrados });
});
