// "Panel Admin" en la sub-barra, solo para administradores (antes se agregaba con JS)
"use client";
import Link from "next/link";
import { useUsuario } from "./ProveedorSitio";

export default function EnlaceAdmin() {
  const usuario = useUsuario();
  if (!usuario?.esAdmin) return null;
  return (
    <Link href="/admin" id="nav-admin-link" style={{ color: "#f59f00" }}>
      <i className="ti ti-shield-check" aria-hidden="true" /> Panel Admin
    </Link>
  );
}
