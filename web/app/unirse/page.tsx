// /unirse: crear una cuenta de proveedor o emprendedor (ROADMAP 2.2). /unirse.html redirige aquí.
import type { Metadata } from "next";
import CabeceraCuenta from "@/componentes/CabeceraCuenta";
import FormularioRegistro from "./_componentes/FormularioRegistro";
import estilos from "./unirse.module.css";

export const metadata: Metadata = { title: "Registro" };

export default function PaginaUnirse() {
  return (
    <div className={estilos.pagina}>
      <CabeceraCuenta />

      <main className="main-container" id="contenido-principal" tabIndex={-1}>
        <div className="register-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- tema.css le pone placa clara a img[src$="logo.png"] */}
          <img src="/logo.png" alt="Logo EntreLazados" className="register-logo" />

          <h2>Crear Cuenta</h2>
          <p className="subtitle">Elige tu perfil y completa el formulario para comenzar</p>

          <FormularioRegistro />

          <div className="divider">
            <span>¿Ya tienes cuenta?</span>
          </div>

          <p style={{ fontSize: 13 }}>
            <a href="/login" className="register-link">
              Inicia sesión aquí
            </a>
          </p>
        </div>
      </main>

      <footer>
        <p>EntreLazados © 2026 - Mercado Digital de Materia Prima y Calzado</p>
        <p style={{ marginTop: 8 }}>
          <a href="/">Inicio</a> | <a href="/mercado.html">Mercado</a> | <a href="/login">Iniciar Sesión</a>
        </p>
      </footer>
    </div>
  );
}
