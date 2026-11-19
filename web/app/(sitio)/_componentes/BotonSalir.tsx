// "Salir" de la portada: cierra la sesión y recarga la portada
"use client";
import { cerrarSesion } from "@/lib/cliente/sesion";

export default function BotonSalir() {
  return (
    <button
      type="button"
      className="btn-nav-register"
      style={{ cursor: "pointer" }}
      onClick={async () => {
        await cerrarSesion();
        window.location.reload();
      }}
    >
      Salir
    </button>
  );
}
