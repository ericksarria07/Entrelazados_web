/* eslint-disable @next/next/no-img-element -- fotos de Unsplash y archivos de public/, igual que antes */
// /inicio: página de inicio con sesión (antes index.html, ROADMAP 2.3)
import type { Metadata } from "next";
import Link from "next/link";
import { fotoUnsplash } from "@/lib/unsplash";
import EnlaceAdmin from "@/componentes/sitio/EnlaceAdmin";
import GlobitoChat from "@/componentes/sitio/GlobitoChat";
import Kan from "@/componentes/sitio/Kan";
import PiePagina from "@/componentes/sitio/PiePagina";
import comun from "@/app/estilos/comun.module.css";
import { datosDeSesionDesdeCookies } from "@/lib/sesion";
import CabeceraInicio from "./_componentes/CabeceraInicio";
import estilos from "./inicio.module.css";

export const metadata: Metadata = { title: "Tu Mercado de Materia Prima para Cuero" };

const UNSPLASH = "auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

const MAS_BUSCADOS = [
  [`https://images.unsplash.com/photo-1599568723850-14196ee0f991?q=80&w=1196&${UNSPLASH}`, "Cuero Vacuno", "Cuero Vacuno Castaño (Pie de 30x30 cm)", "C$ 120.00 NIO"],
  [`https://images.unsplash.com/photo-1628024450128-30c4bb7507eb?q=80&w=1170&${UNSPLASH}`, "Hilo Encerado", "Hilo Encerado N° 9 para Costura Manual", "C$ 280.00 NIO"],
  [`https://plus.unsplash.com/premium_photo-1726769202190-ad2a3f2f360b?q=80&w=1170&${UNSPLASH}`, "Hebilla Metálica", "Hebilla Metálica Antioxidante 35mm", "C$ 45.00 NIO"],
  [`https://images.unsplash.com/photo-1727233432290-10a382f42bb3?q=80&w=688&${UNSPLASH}`, "Trabajo en Taller", "Pegamento Cemento Amarillo", "C$ 850.00 NIO"],
];

export default async function PaginaInicio() {
  const usuario = await datosDeSesionDesdeCookies();

  return (
    <div className={`${comun.pagina} ${estilos.pagina}`}>
      <CabeceraInicio />

      <nav className="sub-bar" aria-label="Secciones">
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

      <section className="hero-banner">
        <h1 className="hero-title">Insumos y Materia Prima para Artesanos del Calzado</h1>
      </section>

      <main className="main-content" id="contenido-principal" tabIndex={-1}>
        <div className="amazon-grid">
          <div className="amazon-card" id="loginCard">
            <h2 id="card-welcome-title">¡Hola de nuevo, {usuario?.nombre || "Usuario"}!</h2>
            <img
              {...fotoUnsplash(`https://images.unsplash.com/photo-1605733160314-4fc7dac4bb16?q=80&w=1190&${UNSPLASH}`, 340)}
              decoding="async"
              className="amazon-card-img"
              alt="Zapatos de Cuero"
            />
            <div id="card-actions">
              <Link href="/mercado" className="btn-nav-login" style={{ textAlign: "center", display: "block", marginBottom: 10 }}>
                Explorar Mercado de Materiales
              </Link>
              <Link href="/perfil" className="amazon-card-link">
                Ver mi Perfil de Negocio →
              </Link>
            </div>
          </div>

          <div className="amazon-card">
            <h2>Cueros y Pieles Populares</h2>
            <div className="sub-grid">
              <div className="sub-grid-item">
                <img {...fotoUnsplash("https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=200", 165)} decoding="async" alt="Vacuno" />
                <span>Vacuno Flor</span>
              </div>
              <div className="sub-grid-item">
                <img {...fotoUnsplash("https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=200", 165)} decoding="async" alt="Gamuza" />
                <span>Gamuza / Suede</span>
              </div>
              <div className="sub-grid-item">
                <img {...fotoUnsplash(`https://images.unsplash.com/photo-1699779328284-d13d2a4e6e6b?q=80&w=687&${UNSPLASH}`, 165)} decoding="async" alt="Suela" />
                <span>Suela Gruesa</span>
              </div>
              <div className="sub-grid-item">
                <img {...fotoUnsplash("https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=200", 165)} decoding="async" alt="Grabado" />
                <span>Cuero Grabado</span>
              </div>
            </div>
            <Link href="/mercado?categoria=Cuero%20Vacuno" className="amazon-card-link">
              Explorar todo en Pieles
            </Link>
          </div>

          <div className="amazon-card">
            <h2>Herrajes y Accesorios</h2>
            <img
              {...fotoUnsplash(`https://plus.unsplash.com/premium_photo-1682145989449-1e625c4982ce?q=80&w=1170&${UNSPLASH}`, 340)}
              loading="lazy"
              decoding="async"
              className="amazon-card-img"
              alt="Herrajes"
            />
            <Link href="/mercado?categoria=Herrajes" className="amazon-card-link">
              Ver Hebillas, Ojetes y Remaches
            </Link>
          </div>

          <div className="amazon-card">
            <h2>Materia Prima Directa de Curtiembres</h2>
            <p className="texto-gris" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 15 }}>
              Conecta directamente con productores de Masaya, Granada y Estelí sin intermediarios.
            </p>
            <img
              {...fotoUnsplash(`https://images.unsplash.com/photo-1607969892714-797a3d4c266a?q=80&w=1170&${UNSPLASH}`, 340)}
              loading="lazy"
              decoding="async"
              className="amazon-card-img"
              alt="Trabajador de Cuero"
            />
            <Link href="/mercado" className="amazon-card-link">
              Conocer Proveedores Verificados
            </Link>
          </div>
        </div>

        <section className="products-shelf">
          <h2 className="shelf-title">Insumos más buscados esta semana</h2>
          <div className="shelf-items">
            {MAS_BUSCADOS.map(([foto, alt, titulo, precio]) => (
              <div className="shelf-item" key={titulo}>
                <img {...fotoUnsplash(foto, 200)} loading="lazy" decoding="async" alt={alt} />
                <Link href="/mercado" className="shelf-item-title">
                  {titulo}
                </Link>
                <div className="price-tag">{precio}</div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <PiePagina />
      <Kan contexto="inicio" />
    </div>
  );
}
