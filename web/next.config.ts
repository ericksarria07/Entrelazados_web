import type { NextConfig } from "next";

// ==========================================================================
// ENCABEZADOS DE SEGURIDAD Y CSP (Content Security Policy)
// La CSP le dice al navegador de dónde puede cargar scripts, estilos, imágenes y
// conexiones; lo demás lo bloquea (frena XSS e inyecciones). Va sin nonces: los nonces
// obligan a renderizar cada página por request y no funcionan con PPR (cacheComponents),
// ver node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md. Por eso
// script-src permite 'unsafe-inline' (los scripts en línea de Next y el del tema), pero
// ningún script de otro sitio. HSTS no va aquí: Vercel ya lo manda en todos los dominios.
// ==========================================================================
const desarrollo = process.env.NODE_ENV === "development";
// En las vistas previas, la barra de comentarios de Vercel (vercel.live)
const vistaPrevia = process.env.VERCEL_ENV === "preview";
const VERCEL_LIVE = vistaPrevia ? ["https://vercel.live"] : [];

function politica(directivas: Record<string, string[]>): string {
  return Object.entries(directivas)
    .map(([nombre, valores]) => [nombre, ...valores].join(" "))
    .join("; ");
}

const CSP = politica({
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", ...(desarrollo ? ["'unsafe-eval'"] : []), ...VERCEL_LIVE],
  // React y Leaflet ponen estilos en línea (style="...")
  "style-src": ["'self'", "'unsafe-inline'", ...VERCEL_LIVE],
  // Imágenes de cualquier sitio con https: las fotos de Vercel Blob, los mosaicos del mapa
  // (OpenStreetMap) y ofertas viejas con fotos enlazadas (Unsplash). Una imagen no ejecuta
  // código; blob: es la vista previa de las fotos antes de subirlas.
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'", "data:", ...(vistaPrevia ? ["https://vercel.live", "https://assets.vercel.com"] : [])],
  // Tiempo real con Ably (la llave se pide a /api/tiempo-real, en el mismo sitio)
  "connect-src": [
    "'self'",
    "https://*.ably.net",
    "wss://*.ably.net",
    "https://*.ably-realtime.com",
    "wss://*.ably-realtime.com",
    ...(vistaPrevia ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : []),
  ],
  "frame-src": vistaPrevia ? VERCEL_LIVE : ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  // Solo en Vercel (siempre https): en local y en el CI el servidor responde por http
  ...(process.env.VERCEL ? { "upgrade-insecure-requests": [] } : {}),
});

// /api/docs (Swagger UI) carga su JS y su CSS desde unpkg con versión fija
const CSP_DOCS = politica({
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "https://unpkg.com"],
  "style-src": ["'self'", "'unsafe-inline'", "https://unpkg.com"],
  "img-src": ["'self'", "data:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "frame-ancestors": ["'none'"],
});

const ENCABEZADOS = [
  { key: "Content-Security-Policy", value: CSP },
  // No adivinar el tipo de un archivo (una foto no puede ejecutarse como script)
  { key: "X-Content-Type-Options", value: "nosniff" },
  // A otros sitios solo se les dice el dominio, nunca la ruta (que puede llevar ?token=)
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nadie puede meter el sitio en un iframe (clickjacking); igual que frame-ancestors
  { key: "X-Frame-Options", value: "DENY" },
  // El sitio no usa cámara, micrófono, ubicación ni pagos
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

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

  // Si dos reglas ponen el mismo encabezado, gana la última: /api/docs usa CSP_DOCS
  async headers() {
    return [
      { source: "/:path*", headers: ENCABEZADOS },
      { source: "/api/docs", headers: [{ key: "Content-Security-Policy", value: CSP_DOCS }] },
    ];
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
      chat: "/chat",
      mercado: "/mercado",
    };
    return Object.entries(nuevas).map(([vieja, nueva]) => ({
      source: `/${vieja}.html`,
      destination: nueva,
      permanent: true,
    }));
  },
};

export default nextConfig;
