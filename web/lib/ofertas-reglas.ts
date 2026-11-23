// ==========================================================================
// REGLAS DE UNA PUBLICACIÓN: lo que se valida al crearla y al editarla.
// Sin base de datos ni Next.js, para probarlas con node --test (pruebas/unidad/).
// lib/ofertas.ts las re-exporta: el resto del código las sigue importando de ahí.
// ==========================================================================
import { enteroPositivo } from "./utilidades.ts";

// Duración permitida de una subasta y precio máximo (numeric(10,2) llega hasta 99.999.999,99)
export const DIAS_SUBASTA = { minimo: 1, maximo: 14, porDefecto: 7 };
export const PRECIO_MAXIMO = 99999999;
export const LARGO_DESCRIPCION = 1000;

export type DatosOferta = {
  titulo: string;
  unidad: string;
  precio: number;
  categoriaId: number;
  distancia: number;
  descripcion: string | null;
};

// Valida los campos de una publicación (al crearla y al editarla)
export function validarOferta(body: Record<string, unknown>): { error: string } | DatosOferta {
  const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";
  const unidad = typeof body.unidad === "string" ? body.unidad.trim() : "";
  const precio = Number(body.precio);
  const categoriaId = enteroPositivo(body.categoriaId);
  if (!titulo || !body.precio || !unidad || !categoriaId) return { error: "Por favor, llena todos los campos obligatorios." };
  if (titulo.length > 120) return { error: "El título puede tener como máximo 120 caracteres." };
  if (unidad.length > 30) return { error: "La unidad de medida puede tener como máximo 30 caracteres." };
  if (!(precio > 0) || precio > PRECIO_MAXIMO) return { error: "El precio debe ser un número mayor que 0." };
  // Descripción opcional (la puede redactar el asistente de IA); vacía se guarda como NULL
  const descripcion = typeof body.descripcion === "string" ? body.descripcion.trim() : "";
  if (descripcion.length > LARGO_DESCRIPCION) {
    return { error: `La descripción puede tener como máximo ${LARGO_DESCRIPCION} caracteres.` };
  }
  const distancia = Math.max(0, Math.min(10000, Math.round(Number(body.distancia) || 0)));
  return { titulo, unidad, precio, categoriaId, distancia, descripcion: descripcion || null };
}
