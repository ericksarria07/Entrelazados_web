// ==========================================================================
// METADATOS PARA COMPARTIR (Open Graph) que repiten varias páginas.
// En Next el openGraph de una página REEMPLAZA al del layout (no se mezclan), así que
// cada página que pone el suyo parte de esta base para no perder el nombre del sitio.
// ==========================================================================
import type { Metadata } from "next";

export const DESCRIPCION_SITIO = "Mercado de materia prima para calzado y marroquinería en Nicaragua";

// La imagen va explícita: si una página pone su propio openGraph, Next ya no hereda la de
// app/opengraph-image.tsx (se comprobó con la portada).
export const OPEN_GRAPH_BASE = {
  siteName: "EntreLazados",
  locale: "es_NI",
  type: "website",
  description: DESCRIPCION_SITIO,
  images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "EntreLazados" }],
} satisfies Metadata["openGraph"];
