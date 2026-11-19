// /admin: panel de administración (antes admin.html, ROADMAP 2.4). Solo administradores:
// el servidor lo revisa antes de pintar (los demás vuelven a /inicio).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Kan from "@/componentes/sitio/Kan";
import { datosDeSesionDesdeCookies } from "@/lib/sesion";
import BotonCerrarSesion from "./_componentes/BotonCerrarSesion";
import PanelAdmin from "./_componentes/PanelAdmin";
import estilos from "./admin.module.css";

export const metadata: Metadata = { title: "Panel de Administración" };

export default async function PaginaAdmin() {
  const sesion = await datosDeSesionDesdeCookies();
  if (!sesion) redirect("/login");
  if (!sesion.esAdmin) redirect("/inicio");

  return (
    <div className={estilos.pagina}>
      <header className="amazon-header">
        <Link href="/inicio" className="logo">
          Entre<span>Lazados</span> Admin
        </Link>
        <span className="admin-badge-header">
          <i className="ti ti-shield-check" aria-hidden="true" /> Modo Administrador
        </span>
        <BotonCerrarSesion />
      </header>

      <nav className="sub-bar" aria-label="Secciones">
        <Link href="/inicio">
          <i className="ti ti-home" aria-hidden="true" /> Ir a la Vista Pública
        </Link>
        <Link href="/dashboard">
          <i className="ti ti-chart-bar" aria-hidden="true" /> Mi Dashboard
        </Link>
        <Link href="/reportes">
          <i className="ti ti-report-analytics" aria-hidden="true" /> Reportes
        </Link>
      </nav>

      <main className="admin-container" id="contenido-principal" tabIndex={-1}>
        <PanelAdmin />
      </main>

      <footer>EntreLazados © 2026 - Módulo de Control Administrativo</footer>
      <Kan contexto="administrador" />
    </div>
  );
}
