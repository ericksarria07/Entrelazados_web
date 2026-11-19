import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,

  // Archivos que las funciones leen del disco y Vercel no copia solo: el logo de los
  // correos (lib/correo.ts) y la especificación de la API (lib/documentacion.ts).
  outputFileTracingIncludes: {
    "/**": ["./public/logo.png"],
    // La especificación de la API que sirven /api/openapi.json y /api/docs
    "/api/openapi.json": ["./docs/openapi.yaml"],
  },

  // Páginas que ya pasaron a React (Fase 2): la URL vieja .html redirige a la nueva y
  // conserva el query string (?token=... de los correos ya enviados).
  async redirects() {
    const nuevas: Record<string, string> = {
      preview: "/",
      index: "/inicio",
      verificar: "/verificar",
      login: "/login",
      unirse: "/unirse",
      restablecer: "/restablecer",
      comprobante: "/comprobante",
      perfil: "/perfil",
      "perfil-publico": "/perfil-publico",
      admin: "/admin",
      reportes: "/reportes",
      dashboard: "/dashboard",
    };
    return Object.entries(nuevas).map(([vieja, nueva]) => ({
      source: `/${vieja}.html`,
      destination: nueva,
      permanent: true,
    }));
  },
};

export default nextConfig;
