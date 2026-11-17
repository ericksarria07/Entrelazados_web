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

  // Durante la migración, las páginas son los HTML copiados de Express en public/.
  // Igual que Express (index: 'preview.html'), la raíz "/" muestra preview.html.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/preview.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
