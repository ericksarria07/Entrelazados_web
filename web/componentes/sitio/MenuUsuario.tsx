// ==========================================================================
// MENÚ DEL USUARIO EN LA CABECERA (antes cada página lo dibujaba con innerHTML)
// La campana va a su izquierda. Sin sesión muestra "Iniciar sesión".
// Los estilos (.user-btn-nav, .dropdown-menu-nav...) son los de cada página.
// ==========================================================================
"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Campana from "./Campana";
import { useUsuario } from "./ProveedorSitio";
import { cerrarSesion } from "@/lib/cliente/sesion";

export default function MenuUsuario({ conCampana = true }: { conCampana?: boolean }) {
  const usuario = useUsuario();
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  // Se cierra al hacer clic en cualquier otra parte de la página
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("click", fuera);
    return () => document.removeEventListener("click", fuera);
  }, [abierto]);

  if (!usuario) {
    return (
      <Link href="/login" className="user-btn-nav" style={{ textDecoration: "none" }}>
        <i className="ti ti-login" aria-hidden="true" /> <span className="user-nav-name">Iniciar sesión</span>
      </Link>
    );
  }

  async function salir() {
    await cerrarSesion();
    // En la portada solo se recarga; en las demás, al login
    window.location.href = ruta === "/" ? "/" : "/login";
  }

  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {conCampana && <Campana />}
      <div className="user-dropdown-wrapper" ref={caja}>
        <button
          type="button"
          className="user-btn-nav"
          aria-haspopup="true"
          aria-expanded={abierto}
          onClick={() => setAbierto((a) => !a)}
        >
          <i className="ti ti-user-circle" style={{ fontSize: 22 }} aria-hidden="true" />
          <div className="user-nav-text">
            <span className="user-nav-name">{usuario.nombre}</span>
            <span className="user-nav-role">{(usuario.rol || "Miembro").toUpperCase()}</span>
          </div>
          <i className="ti ti-chevron-down" style={{ fontSize: 14, marginLeft: 2 }} aria-hidden="true" />
        </button>

        <div className={`dropdown-menu-nav${abierto ? " show" : ""}`} id="userDropdownMenu">
          <Link href="/perfil" className="dropdown-item-nav">
            <i className="ti ti-id" style={{ fontSize: 18, color: "var(--color-principal)" }} aria-hidden="true" />
            Ver mi perfil
          </Link>
          <div className="dropdown-divider-nav" />
          <button
            type="button"
            onClick={salir}
            className="dropdown-item-nav logout-item"
            style={{ width: "100%", border: 0, background: "none", font: "inherit", cursor: "pointer", fontWeight: 600 }}
          >
            <i className="ti ti-logout" style={{ fontSize: 18 }} aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
