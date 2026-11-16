import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "EntreLazados",
  description: "Mercado de materia prima para calzado y marroquinería en Nicaragua",
};

// Layout raíz. Por ahora no hay páginas React: el sitio sirve los HTML de public/
// (copiados de Express) y se irán pasando a React uno por uno (ver ROADMAP.md).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
