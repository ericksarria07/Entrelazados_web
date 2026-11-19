"use client";
// ==========================================================================
// BOTÓN DE MODO OSCURO (antes lo agregaba public/tema.js)
//
// El tema inicial lo pone el script en línea de app/layout.tsx antes de pintar
// (<html data-tema="claro|oscuro">), así no parpadea. Este botón lo cambia y lo
// guarda en localStorage "entrelazados-tema", la misma clave que las páginas
// viejas: el modo elegido se respeta en todo el sitio.
// Sin elección guardada sigue el modo del sistema; al imprimir usa el claro.
// ==========================================================================
import { useEffect, useSyncExternalStore } from "react";

const CLAVE = "entrelazados-tema";
type Tema = "claro" | "oscuro";

function guardado(): Tema | null {
  try {
    const t = localStorage.getItem(CLAVE);
    return t === "claro" || t === "oscuro" ? t : null;
  } catch {
    return null;
  }
}

const sistemaOscuro = () => window.matchMedia?.("(prefers-color-scheme: dark)");
const temaPreferido = (): Tema => guardado() ?? (sistemaOscuro()?.matches ? "oscuro" : "claro");

function aplicar(tema: Tema) {
  const raiz = document.documentElement;
  raiz.setAttribute("data-tema", tema);
  raiz.style.colorScheme = tema === "oscuro" ? "dark" : "light";
}

// El tema "real" es el atributo de <html>: se observa para repintar el botón
function suscribir(avisar: () => void) {
  const observador = new MutationObserver(avisar);
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
  return () => observador.disconnect();
}
const temaDelDocumento = (): Tema => (document.documentElement.getAttribute("data-tema") === "oscuro" ? "oscuro" : "claro");

export default function BotonTema() {
  const tema = useSyncExternalStore(suscribir, temaDelDocumento, () => null);

  useEffect(() => {
    const sistema = sistemaOscuro();
    const alCambiarSistema = () => {
      if (!guardado()) aplicar(temaPreferido());
    };
    // Otra pestaña cambió el tema
    const alCambiarOtraPestana = (e: StorageEvent) => {
      if (e.key === CLAVE) aplicar(temaPreferido());
    };
    // Papel blanco: al imprimir siempre en claro
    let antesDeImprimir: Tema | null = null;
    const antesImprimir = () => {
      if (temaDelDocumento() !== "oscuro") return;
      antesDeImprimir = "oscuro";
      aplicar("claro");
    };
    const despuesImprimir = () => {
      if (antesDeImprimir) aplicar(antesDeImprimir);
      antesDeImprimir = null;
    };
    sistema?.addEventListener("change", alCambiarSistema);
    window.addEventListener("storage", alCambiarOtraPestana);
    window.addEventListener("beforeprint", antesImprimir);
    window.addEventListener("afterprint", despuesImprimir);
    return () => {
      sistema?.removeEventListener("change", alCambiarSistema);
      window.removeEventListener("storage", alCambiarOtraPestana);
      window.removeEventListener("beforeprint", antesImprimir);
      window.removeEventListener("afterprint", despuesImprimir);
    };
  }, []);

  const oscuro = tema === "oscuro";
  const etiqueta = oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro";

  function alternar() {
    const nuevo: Tema = temaDelDocumento() === "oscuro" ? "claro" : "oscuro";
    try {
      localStorage.setItem(CLAVE, nuevo);
    } catch {
      /* bloqueado: se cambia solo en esta página */
    }
    aplicar(nuevo);
  }

  return (
    <button type="button" className="tema-boton" aria-pressed={oscuro} aria-label={etiqueta} title={etiqueta} onClick={alternar}>
      <i className={`ti ${oscuro ? "ti-sun" : "ti-moon"}`} aria-hidden="true" />
    </button>
  );
}
