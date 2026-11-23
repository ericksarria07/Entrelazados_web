// /sitemap.xml: las páginas públicas y cada perfil público activo, para los buscadores.
// Consulta la base, así que se arma al atender la petición (connection), no en el build.
import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { urlDelSitio } from "@/lib/config";
import { listarPerfilesPublicos } from "@/lib/usuarios";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = urlDelSitio();
  const publicas: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/unirse`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/login`, changeFrequency: "monthly", priority: 0.3 },
  ];
  // Si la base no contesta, al menos salen las páginas públicas
  const perfiles = await listarPerfilesPublicos().catch(() => []);
  return [
    ...publicas,
    ...perfiles.map((p) => ({
      url: `${base}/perfil-publico?id=${p.id}`,
      lastModified: p.desde,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
