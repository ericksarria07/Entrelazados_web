// /reportes: reportes con gráficas, PDF y Excel (antes reportes.html, ROADMAP 2.4)
import type { Metadata } from "next";
import Link from "next/link";
import Buscador from "@/componentes/sitio/Buscador";
import Cabecera from "@/componentes/sitio/Cabecera";
import EnlaceAdmin from "@/componentes/sitio/EnlaceAdmin";
import GlobitoChat from "@/componentes/sitio/GlobitoChat";
import Kan from "@/componentes/sitio/Kan";
import PiePagina from "@/componentes/sitio/PiePagina";
import comun from "@/app/estilos/comun.module.css";
import panel from "@/app/estilos/panel.module.css";
import Reportes from "./_componentes/Reportes";
import estilos from "./reportes.module.css";

export const metadata: Metadata = { title: "Reportes" };

export default function PaginaReportes() {
  return (
    <div className={`${comun.pagina} ${panel.pagina} ${estilos.pagina}`}>
      <Cabecera>
        <Buscador />
      </Cabecera>

      <nav className="sub-bar" aria-label="Secciones">
        <Link href="/inicio">Inicio</Link>
        <Link href="/mercado">Mercado Completo</Link>
        <Link href="/chat">
          Chat
          <GlobitoChat />
        </Link>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/reportes" className="active">
          Reportes
        </Link>
        <EnlaceAdmin />
      </nav>

      <Reportes />

      <PiePagina
        enlaces={[
          ["/inicio", "Inicio"],
          ["/mercado", "Mercado"],
          ["/chat", "Chat"],
          ["/dashboard", "Dashboard"],
          ["/reportes", "Reportes"],
        ]}
      />
      <Kan contexto="dashboard" />
    </div>
  );
}
