"use client";
// Error inesperado al pintar una página: en vez de la pantalla genérica de Next.js,
// un aviso en español con "Reintentar" (vuelve a pedir y pintar la página) y un
// enlace a la portada. En producción el mensaje real no llega al navegador; el
// código (digest) sirve para buscar el error en los registros de Vercel.
import { useEffect } from "react";
import Link from "next/link";
import PantallaAviso, { codigoDelError } from "@/componentes/PantallaAviso";

export default function ErrorDePagina({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const codigo = codigoDelError(error);

  return (
    <PantallaAviso
      icono="alert-triangle"
      titulo="Algo salió mal"
      texto="No pudimos mostrar esta página. Puedes intentarlo de nuevo en un momento."
    >
      <button type="button" className="boton" id="btn-reintentar" onClick={() => retry()}>
        <i className="ti ti-refresh" aria-hidden="true" /> Reintentar
      </button>
      <Link href="/" className="boton secundario">
        <i className="ti ti-home" aria-hidden="true" /> Ir a la portada
      </Link>
      {codigo && <p className="codigo">Código del error: {codigo}</p>}
    </PantallaAviso>
  );
}
