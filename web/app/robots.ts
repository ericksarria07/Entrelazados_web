// /robots.txt: los buscadores pueden leer la portada, el registro y los perfiles públicos;
// las páginas con sesión, la API y los enlaces de un solo uso quedan fuera.
import type { MetadataRoute } from "next";
import { urlDelSitio } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  const base = urlDelSitio();
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/perfil-publico", "/unirse", "/login"],
      disallow: [
        "/api/",
        "/admin",
        "/chat",
        "/dashboard",
        "/inicio",
        "/mercado",
        "/perfil$",
        "/reportes",
        "/comprobante",
        "/verificar",
        "/restablecer",
        "/uploads/",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
