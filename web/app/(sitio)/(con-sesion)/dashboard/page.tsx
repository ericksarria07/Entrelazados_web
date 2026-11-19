// /dashboard: panel de control (antes dashboard.html, ROADMAP 2.5)
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
import Dashboard from "./_componentes/Dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function PaginaDashboard() {
  return (
    <div className={`${comun.pagina} ${panel.pagina}`}>
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
        <Link href="/dashboard" className="active">
          Dashboard
        </Link>
        <Link href="/reportes">
          <i className="ti ti-report-analytics" aria-hidden="true" /> Reportes
        </Link>
        <EnlaceAdmin />
      </nav>

      <Dashboard />

      <PiePagina />
      <Kan contexto="dashboard" />
    </div>
  );
}
