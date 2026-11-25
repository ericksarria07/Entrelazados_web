// Tarjeta centrada con logo, ícono, título y texto, para las páginas de aviso:
// 404 (app/not-found.tsx) y errores (app/error.tsx, app/global-error.tsx).
// Sin hooks: sirve igual en componentes de servidor y de cliente.
import estilos from "./pantalla-aviso.module.css";

// El código (digest) que Next.js le pone a los errores del servidor: en producción el
// mensaje real no llega al navegador y con el código se busca en los registros.
export function codigoDelError(error: unknown): string | null {
  return error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
}

export default function PantallaAviso({
  icono,
  titulo,
  texto,
  children,
}: {
  icono: string;
  titulo: string;
  texto: string;
  children: React.ReactNode;
}) {
  return (
    <div className={estilos.pagina}>
      <main className="tarjeta" id="contenido-principal" tabIndex={-1}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tema.css le pone placa clara a img[src$="logo.png"] */}
        <img className="logo" src="/logo.png" alt="EntreLazados" />
        <div className="icono-grande">
          <i className={`ti ti-${icono}`} aria-hidden="true" />
        </div>
        <h1>{titulo}</h1>
        <p className="subtitulo">{texto}</p>
        {children}
      </main>
    </div>
  );
}
