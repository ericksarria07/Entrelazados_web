// GET /api/cron/cerrar-subastas: el cron diario de Vercel (vercel.json) cierra las subastas
// vencidas que nadie miró. Vercel manda "Authorization: Bearer <CRON_SECRET>"; sin
// CRON_SECRET configurado, la ruta no responde a nadie.
import { urlPublica } from "@/lib/config";
import { cerrarVencidas } from "@/lib/cierre-subastas";
import { json, ruta } from "@/lib/http";

export const GET = ruta(async (req) => {
  const secreto = (process.env.CRON_SECRET ?? "").trim();
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return json({ message: "No autorizado." }, 401);
  }
  const cerradas = await cerrarVencidas(urlPublica(req));
  return json({ cerradas: cerradas.length });
});
