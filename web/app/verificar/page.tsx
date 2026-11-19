// /verificar?token=...: el enlace que llega por correo al registrarse (ROADMAP 2.1).
// Primera página en React. La vieja /verificar.html redirige aquí (next.config.ts),
// así que los enlaces de correos ya enviados siguen funcionando.
import type { Metadata } from "next";
import { Suspense } from "react";
import Verificacion, { Cargando } from "./_componentes/Verificacion";
import estilos from "./verificar.module.css";

export const metadata: Metadata = {
  title: "Confirmar correo",
  robots: { index: false },
  // El token va en la URL: que no viaje a otros sitios
  referrer: "no-referrer",
};

export default function PaginaVerificar() {
  return (
    <div className={estilos.pagina}>
      <main className="tarjeta" id="contenido-principal" tabIndex={-1}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tema.css le pone placa clara a img[src$="logo.png"] */}
        <img className="logo" src="/logo.png" alt="EntreLazados" />
        <Suspense fallback={<Cargando />}>
          <Verificacion />
        </Suspense>
      </main>
    </div>
  );
}
