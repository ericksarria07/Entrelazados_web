// /mercado: ofertas, subastas en vivo, mapa, favoritos y publicar (antes mercado.html, ROADMAP 2.7)
import type { Metadata } from "next";
import { Suspense } from "react";
import Kan from "@/componentes/sitio/Kan";
import PiePagina from "@/componentes/sitio/PiePagina";
import comun from "@/app/estilos/comun.module.css";
import mercado from "@/app/estilos/mercado.module.css";
import Mercado from "./_componentes/Mercado";

export const metadata: Metadata = { title: "Mercado de Materia Prima" };

export default function PaginaMercado() {
  return (
    <div className={`${comun.pagina} ${mercado.pagina}`}>
      {/* useSearchParams (?q=, ?categoria=, ?oferta=...) va dentro de <Suspense> */}
      <Suspense>
        <Mercado />
      </Suspense>

      <PiePagina
        enlaces={[
          ["/inicio", "Inicio"],
          ["/mercado", "Mercado"],
          ["/chat", "Chat"],
          ["/perfil", "Mi Perfil"],
        ]}
      />
      <Kan contexto="mercado" />
    </div>
  );
}
