// /restablecer: recuperar la contraseña (ROADMAP 2.2). /restablecer.html redirige aquí,
// así que los enlaces de los correos ya enviados (?token=...) siguen funcionando.
import type { Metadata } from "next";
import { Suspense } from "react";
import Restablecer, { Cargando } from "./_componentes/Restablecer";
import estilos from "./restablecer.module.css";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  robots: { index: false },
  // El token va en la URL: que no viaje a otros sitios
  referrer: "no-referrer",
};

export default function PaginaRestablecer() {
  return (
    <div className={estilos.pagina}>
      <main className="tarjeta" id="contenido-principal" tabIndex={-1}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tema.css le pone placa clara a img[src$="logo.png"] */}
        <img className="logo" src="/logo.png" alt="EntreLazados" />
        <Suspense fallback={<Cargando />}>
          <Restablecer />
        </Suspense>
      </main>
    </div>
  );
}
