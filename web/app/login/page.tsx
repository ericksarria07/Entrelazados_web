// /login: iniciar sesión (ROADMAP 2.2). /login.html redirige aquí.
import Link from "next/link";
import type { Metadata } from "next";
import CabeceraCuenta from "@/componentes/CabeceraCuenta";
import FormularioLogin from "./_componentes/FormularioLogin";
import estilos from "./login.module.css";

export const metadata: Metadata = { title: "Iniciar Sesión" };

export default function PaginaLogin() {
  return (
    <div className={estilos.pagina}>
      <CabeceraCuenta />

      <main className="main-container" id="contenido-principal" tabIndex={-1}>
        <div className="login-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- tema.css le pone placa clara a img[src$="logo.png"] */}
          <img src="/logo.png" alt="Logo EntreLazados" className="login-logo" />

          <h2>Iniciar Sesión</h2>
          <p className="subtitle">Ingresa tu correo y contraseña para ingresar a la plataforma</p>

          <FormularioLogin />

          <div className="divider">
            <span>¿No tienes cuenta?</span>
          </div>

          <p style={{ fontSize: 13 }}>
            <Link href="/unirse" className="register-link">
              Regístrate aquí
            </Link>
          </p>
        </div>
      </main>

      <footer>
        <div className="footer-container">
          <div className="footer-brand">
            NICA<span>RAGUA</span>
          </div>

          <div className="footer-center">
            <p>EntreLazados © 2026 - Plataforma de Comercio de Materia Prima y Calzado</p>
            <p style={{ marginTop: 8 }}>
              <Link href="/inicio">Inicio</Link> | <Link href="/mercado">Mercado</Link> | <Link href="/chat">Chat</Link> |{" "}
              <Link href="/perfil">Mi Perfil</Link>
            </p>
          </div>

          <div className="footer-volcano">
            {/* eslint-disable-next-line @next/next/no-img-element -- mismo archivo de public/ que las páginas viejas */}
            <img src="/volcan.webp" loading="lazy" decoding="async" alt="Volcán Nicaragua" />
          </div>
        </div>
      </footer>
    </div>
  );
}
