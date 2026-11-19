// ==========================================================================
// CABECERA DE LAS PÁGINAS CON SESIÓN (antes copiada en cada HTML)
// Logo, "Enviar a <departamento>", buscador (opcional) y menú del usuario con la
// campana. Los estilos (.amazon-header, .search-bar...) son los de cada página.
// ==========================================================================
"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import MenuUsuario from "./MenuUsuario";
import { useUsuario } from "./ProveedorSitio";

export default function Cabecera({ children, ubicacion = true }: { children?: ReactNode; ubicacion?: boolean }) {
  const usuario = useUsuario();
  return (
    <header className="amazon-header">
      <Link href={usuario ? "/inicio" : "/"} className="logo">
        Entre<span>Lazados</span>
      </Link>

      {ubicacion && (
        <div className="header-location">
          <i className="ti ti-map-pin" style={{ fontSize: 18 }} aria-hidden="true" />
          <div>
            <span className="location-label">Enviar a</span>
            <strong id="user-location">{usuario?.departamento || "Nicaragua"}</strong>
          </div>
        </div>
      )}

      {children}

      <div className="nav-user">
        <MenuUsuario />
      </div>
    </header>
  );
}
