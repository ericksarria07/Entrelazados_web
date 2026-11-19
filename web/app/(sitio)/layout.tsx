// ==========================================================================
// LAYOUT DE LAS PÁGINAS DEL SITIO (portada, inicio, mercado, chat, paneles...)
//
// Lee la cookie de sesión en el servidor y le pasa a ProveedorSitio quién entró
// (o null): menú, campana, globito de no leídos y Kan ya saben el nombre y el rol
// al pintar. Leer la cookie hace la página dinámica: va dentro de <Suspense>.
// Las páginas que exigen sesión están en (con-sesion)/.
// ==========================================================================
import { Suspense } from "react";
import ProveedorSitio from "@/componentes/sitio/ProveedorSitio";
import { datosDeSesionDesdeCookies } from "@/lib/sesion";
import PantallaCarga from "@/componentes/sitio/PantallaCarga";

async function ConUsuario({ children }: { children: React.ReactNode }) {
  const usuario = await datosDeSesionDesdeCookies();
  return <ProveedorSitio usuario={usuario}>{children}</ProveedorSitio>;
}

export default function LayoutSitio({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<PantallaCarga />}>
      <ConUsuario>{children}</ConUsuario>
    </Suspense>
  );
}
