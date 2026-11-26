"use client";
// Error en el propio layout raíz: reemplaza todo el documento, así que arma su
// <html>, carga los estilos y los íconos y aplica el tema antes de pintar.
// Usa <a> y no <Link>: el router puede ser justo lo que falló.
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import "./estilos/base.css";
import "./estilos/tema.css";
import PantallaAviso, { codigoDelError } from "@/componentes/PantallaAviso";
import { SCRIPT_TEMA } from "@/lib/script-tema";

export default function ErrorGeneral({ error, retry }: { error: unknown; retry: () => void }) {
  const codigo = codigoDelError(error);
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <title>Algo salió mal - EntreLazados</title>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>
        <PantallaAviso
          icono="alert-triangle"
          titulo="Algo salió mal"
          texto="EntreLazados no pudo cargar. Puedes intentarlo de nuevo en un momento."
        >
          <button type="button" className="boton" onClick={() => retry()}>
            <i className="ti ti-refresh" aria-hidden="true" /> Reintentar
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- el router puede ser lo que falló */}
          <a href="/" className="boton secundario">
            <i className="ti ti-home" aria-hidden="true" /> Ir a la portada
          </a>
          {codigo && <p className="codigo">Código del error: {codigo}</p>}
        </PantallaAviso>
      </body>
    </html>
  );
}
