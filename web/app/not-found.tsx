// Página 404: una dirección que no existe o un notFound() de una página. Se pinta
// dentro del layout raíz, así que ya tiene la letra, los íconos y el modo oscuro.
import type { Metadata } from "next";
import Link from "next/link";
import PantallaAviso from "@/componentes/PantallaAviso";

// Sin "robots": Next.js ya agrega <meta name="robots" content="noindex"> a la 404.
export const metadata: Metadata = { title: "Página no encontrada" };

export default function NoEncontrada() {
  return (
    <PantallaAviso
      icono="map-search"
      titulo="No encontramos esta página"
      texto="Puede que el enlace esté mal escrito o que la página ya no exista."
    >
      <Link href="/" className="boton" id="btn-portada">
        <i className="ti ti-home" aria-hidden="true" /> Ir a la portada
      </Link>
      <Link href="/mercado" className="boton secundario">
        <i className="ti ti-building-store" aria-hidden="true" /> Ver el mercado
      </Link>
    </PantallaAviso>
  );
}
