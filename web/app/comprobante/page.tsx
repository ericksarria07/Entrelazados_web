// /comprobante?trato=ID: comprobante de un trato para imprimir o guardar como PDF
// (ROADMAP 2.2). /comprobante.html redirige aquí.
import type { Metadata } from "next";
import { Suspense } from "react";
import Comprobante, { CargandoComprobante } from "./_componentes/Comprobante";
import estilos from "./comprobante.module.css";

export const metadata: Metadata = { title: "Comprobante de trato", robots: { index: false } };

export default function PaginaComprobante() {
  return (
    <div className={estilos.pagina}>
      <Suspense fallback={<CargandoComprobante />}>
        <Comprobante />
      </Suspense>
    </div>
  );
}
