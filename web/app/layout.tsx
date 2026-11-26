// ==========================================================================
// LAYOUT RAÍZ DE LAS PÁGINAS EN REACT (Fase 2)
//
// Todas las páginas pasan por aquí y reciben:
//   - la letra Source Sans 3 (next/font, sin pedirla a Google en cada visita),
//   - los íconos Tabler (npm, versión fija),
//   - los colores base y el modo oscuro (app/estilos/tema.css, el mismo de siempre),
//   - el script del tema antes de pintar (sin parpadeo), "Saltar al contenido"
//     y el botón de modo oscuro.
// ==========================================================================
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import BotonTema from "@/componentes/BotonTema";
import { urlDelSitio } from "@/lib/config";
import { DESCRIPCION_SITIO, OPEN_GRAPH_BASE } from "@/lib/metadatos";
import { SCRIPT_TEMA } from "@/lib/script-tema";
import "./estilos/base.css";
import "./estilos/tema.css";

const fuente = Source_Sans_3({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--fuente-base",
  display: "swap",
});

// metadataBase: con él, las imágenes y enlaces de Open Graph salen con la dirección completa
// (WhatsApp y Facebook no entienden rutas relativas). La imagen para compartir la arma
// app/opengraph-image.tsx.
export const metadata: Metadata = {
  metadataBase: new URL(urlDelSitio()),
  title: { default: "EntreLazados", template: "%s - EntreLazados" },
  description: DESCRIPCION_SITIO,
  icons: { icon: "/logo.png" },
  openGraph: OPEN_GRAPH_BASE,
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // El script cambia data-tema antes de que React hidrate
    <html lang="es" className={fuente.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>
        <a className="saltar-contenido" href="#contenido-principal">
          Saltar al contenido
        </a>
        {children}
        <BotonTema />
      </body>
    </html>
  );
}
