import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,

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
