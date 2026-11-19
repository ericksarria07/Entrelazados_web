// /chat: mensajes directos y Kan (antes chat.html, ROADMAP 2.6). /chat?contacto=ID abre esa conversación.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Buscador from "@/componentes/sitio/Buscador";
import Cabecera from "@/componentes/sitio/Cabecera";
import EnlaceAdmin from "@/componentes/sitio/EnlaceAdmin";
import GlobitoChat from "@/componentes/sitio/GlobitoChat";
import PiePagina from "@/componentes/sitio/PiePagina";
import comun from "@/app/estilos/comun.module.css";
import Chat from "./_componentes/Chat";
import estilos from "./chat.module.css";

export const metadata: Metadata = { title: "Chat" };

export default function PaginaChat() {
  return (
    <div className={`${comun.pagina} ${estilos.pagina}`}>
      <Cabecera>
        <Buscador />
      </Cabecera>

      <nav className="sub-bar" aria-label="Secciones">
        <Link href="/inicio">
          <i className="ti ti-home" aria-hidden="true" /> Inicio
        </Link>
        <Link href="/mercado">
          <i className="ti ti-building-store" aria-hidden="true" /> Mercado Completo
        </Link>
        <Link href="/chat" className="active">
          <i className="ti ti-message-circle" aria-hidden="true" /> Chats
          <GlobitoChat />
        </Link>
        <Link href="/dashboard">
          <i className="ti ti-chart-bar" aria-hidden="true" /> Dashboard
        </Link>
        <EnlaceAdmin />
      </nav>

      <span id="contenido-principal" tabIndex={-1} />
      {/* useSearchParams (?contacto=) va dentro de <Suspense> */}
      <Suspense>
        <Chat />
      </Suspense>

      <PiePagina
        enlaces={[
          ["/inicio", "Inicio"],
          ["/mercado", "Mercado"],
          ["/dashboard", "Dashboard"],
          ["/perfil", "Mi Perfil"],
        ]}
      />
    </div>
  );
}
