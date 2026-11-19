// Pie de página de las páginas del sitio (los estilos de footer son los de cada página)
import Link from "next/link";

const TODOS: [string, string][] = [
  ["/inicio", "Inicio"],
  ["/mercado", "Mercado"],
  ["/chat", "Chat"],
  ["/dashboard", "Dashboard"],
  ["/perfil", "Mi Perfil"],
];

export default function PiePagina({ enlaces = TODOS }: { enlaces?: [string, string][] }) {
  return (
    <footer>
      <div className="footer-container">
        <div className="footer-brand">
          NICA<span>RAGUA</span>
        </div>

        <div className="footer-center">
          <p>EntreLazados © 2026 - Plataforma de Comercio de Materia Prima y Calzado</p>
          <p style={{ marginTop: 8 }}>
            {enlaces.map(([href, texto], i) => (
              <span key={href}>
                {i > 0 && " | "}
                <Link href={href}>{texto}</Link>
              </span>
            ))}
          </p>
        </div>

        <div className="footer-volcano">
          {/* eslint-disable-next-line @next/next/no-img-element -- mismo archivo de public/ que antes */}
          <img src="/volcan.webp" alt="Volcán Nicaragua" />
        </div>
      </div>
    </footer>
  );
}
