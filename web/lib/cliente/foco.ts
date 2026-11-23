// Foco de las ventanas modales (accesibilidad con teclado):
//  - al abrir, el foco entra a la ventana (al primer campo, si nadie adentro lo tiene ya);
//  - Tab y Shift+Tab dan la vuelta dentro de la ventana, sin escaparse a la página de atrás;
//  - al cerrar, el foco vuelve a donde estaba (el botón que la abrió).
//   const caja = useRef<HTMLDivElement>(null);
//   useFocoModal(caja, abierto);
"use client";
import { type RefObject, useEffect } from "react";

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CAMPOS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

// Solo los visibles (un elemento con display:none no tiene offsetParent)
const visibles = (caja: HTMLElement, selector: string) =>
  Array.from(caja.querySelectorAll<HTMLElement>(selector)).filter((el) => el.offsetParent !== null);

export function useFocoModal(ref: RefObject<HTMLElement | null>, abierto: boolean) {
  useEffect(() => {
    const caja = ref.current;
    if (!abierto || !caja) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Espera a que la ventana se pinte (y a que ella misma enfoque su campo principal, si lo hace)
    const espera = setTimeout(() => {
      if (!caja.contains(document.activeElement)) (visibles(caja, CAMPOS)[0] ?? visibles(caja, ENFOCABLES)[0])?.focus();
    }, 80);

    const alTabular = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const lista = visibles(caja, ENFOCABLES);
      if (!lista.length) return;
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    caja.addEventListener("keydown", alTabular);

    return () => {
      clearTimeout(espera);
      caja.removeEventListener("keydown", alTabular);
      if (anterior && document.contains(anterior)) anterior.focus();
    };
  }, [abierto, ref]);
}
