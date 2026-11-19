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
import "./estilos/base.css";
import "./estilos/tema.css";

const fuente = Source_Sans_3({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--fuente-base",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "EntreLazados", template: "%s - EntreLazados" },
  description: "Mercado de materia prima para calzado y marroquinería en Nicaragua",
  icons: { icon: "/logo.png" },
};

// Igual que tema.js: elección guardada o, si no hay, el modo del sistema. Va en línea
// para que corra antes de pintar.
const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem('entrelazados-tema');if(t!=='claro'&&t!=='oscuro'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'oscuro':'claro'}var r=document.documentElement;r.setAttribute('data-tema',t);r.style.colorScheme=t==='oscuro'?'dark':'light'}catch(e){}})();`;

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
