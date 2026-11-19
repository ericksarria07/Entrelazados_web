// Páginas que exigen sesión: sin cookie válida (vencida, cuenta suspendida o
// eliminada) se va a /login, antes de pintar nada.
import { redirect } from "next/navigation";
import { Suspense } from "react";
import PantallaCarga from "@/componentes/sitio/PantallaCarga";
import { datosDeSesionDesdeCookies } from "@/lib/sesion";

async function ExigirSesion({ children }: { children: React.ReactNode }) {
  if (!(await datosDeSesionDesdeCookies())) redirect("/login");
  return children;
}

export default function LayoutConSesion({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<PantallaCarga />}>
      <ExigirSesion>{children}</ExigirSesion>
    </Suspense>
  );
}
