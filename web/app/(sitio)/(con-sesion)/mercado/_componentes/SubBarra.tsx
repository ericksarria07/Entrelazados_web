// Sub-barra de secciones del Mercado
import Link from "next/link";
import EnlaceAdmin from "@/componentes/sitio/EnlaceAdmin";
import GlobitoChat from "@/componentes/sitio/GlobitoChat";

export default function SubBarra() {
  return (
    <nav className="sub-bar" aria-label="Secciones">
      <Link href="/inicio">
        <i className="ti ti-home" aria-hidden="true" /> Inicio
      </Link>
      <Link href="/mercado" className="active">
        <i className="ti ti-building-store" aria-hidden="true" /> Mercado
      </Link>
      <Link href="/chat">
        <i className="ti ti-message-circle" aria-hidden="true" /> Chats
        <GlobitoChat />
      </Link>
      <Link href="/dashboard">
        <i className="ti ti-chart-bar" aria-hidden="true" /> Dashboard
      </Link>
      <EnlaceAdmin />
    </nav>
  );
}
