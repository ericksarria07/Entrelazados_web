import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,

  // Los correos llevan el logo adjunto (lib/correo.ts lo lee de public/). Vercel no
  // copia public/ dentro de las funciones, así que se incluye a mano.
  outputFileTracingIncludes: {
    "/**": ["./public/logo.png"],
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
