"use client";
import { cerrarSesion } from "@/lib/cliente/sesion";

export default function BotonCerrarSesion() {
  return (
    <button
      type="button"
      className="user-btn-nav"
      onClick={async () => {
        await cerrarSesion();
        // Navegación completa: nada guardado de la sesión anterior se reutiliza
        window.location.replace(new URL("/login", window.location.origin).href);
      }}
    >
      <i className="ti ti-logout" aria-hidden="true" /> Cerrar Sesión
    </button>
  );
}
