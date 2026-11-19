// ==========================================================================
// CATEGORÍAS DE MATERIALES (antes public/categorias.js)
// Se leen de la base (GET /api/categorias): si el admin crea una, aparece sola en
// los formularios y en el buscador. Una sola petición por página.
// ==========================================================================
"use client";
import { useEffect, useState } from "react";

export type Categoria = { CategoriaID: number; NombreCategoria: string };

let pendiente: Promise<Categoria[]> | null = null;

export function cargarCategorias(): Promise<Categoria[]> {
  if (!pendiente) {
    pendiente = fetch("/api/categorias")
      .then((res) => (res.ok ? res.json() : []))
      .then((lista) => (Array.isArray(lista) ? lista : []))
      .catch(() => []);
  }
  return pendiente;
}

// Para cuando el admin crea una categoría nueva
export function olvidarCategorias() {
  pendiente = null;
}

export function useCategorias(): Categoria[] | null {
  const [lista, setLista] = useState<Categoria[] | null>(null);
  useEffect(() => {
    let vivo = true;
    cargarCategorias().then((l) => vivo && setLista(l));
    return () => {
      vivo = false;
    };
  }, []);
  return lista;
}

const limpiar = (texto: string) =>
  String(texto || "")
    .toLowerCase()
    .replace(/&/g, "y")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

// El CategoriaID cuyo nombre comparte más palabras con el texto (enlaces viejos ?categoria=texto).
// "Cuero Vacuno" → "Cuero Bovino / Vacuno"; "Herrajes" → "Herrajes, Hebillas y Mosquetones"
export function buscarCategoriaPorTexto(lista: Categoria[], texto: string): number | null {
  const palabras = limpiar(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 3);
  let mejor: number | null = null;
  let puntos = 0;
  for (const c of lista) {
    const nombre = limpiar(c.NombreCategoria);
    const coincidencias = palabras.filter((p) => nombre.includes(p)).length;
    if (coincidencias > puntos) {
      mejor = c.CategoriaID;
      puntos = coincidencias;
    }
  }
  return mejor;
}
