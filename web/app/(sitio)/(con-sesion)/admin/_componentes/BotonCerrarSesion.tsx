"use client";
import { useRouter } from "next/navigation";
import { cerrarSesion } from "@/lib/cliente/sesion";

export default function BotonCerrarSesion() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="user-btn-nav"
      onClick={async () => {
        await cerrarSesion();
        router.replace("/login");
      }}
    >
      <i className="ti ti-logout" aria-hidden="true" /> Cerrar Sesión
    </button>
  );
}
