// ==========================================================================
// ALERTAS DE BÚSQUEDA: las reglas puras (sin base de datos ni Next.js), para
// probarlas con node --test (pruebas/unidad/). lib/favoritos.ts las re-exporta.
// ==========================================================================
import { PRECIO_MAXIMO } from "./ofertas-reglas.ts";
import { enteroPositivo, textoLimpio } from "./utilidades.ts";

const LARGO_PALABRA = 60;

export type Alerta = {
  AlertaID?: number;
  UsuarioID?: number;
  PalabraClave: string | null;
  CategoriaID: number | null;
  NombreCategoria?: string | null;
  PrecioMaximo: string | number | null;
};

export type OfertaParaAvisos = {
  ofertaId: number;
  proveedorId: number;
  titulo: string;
  descripcion: string | null;
  categoriaId: number;
  precio: number;
};

// "Cuero CAFÉ " -> "cuero cafe": las alertas no distinguen mayúsculas ni tildes
export const normalizar = (texto: unknown) =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// Valida lo que llega del formulario de alertas. Devuelve { error } o los datos limpios.
export function validarAlerta(body: Record<string, unknown> = {}) {
  const palabra = textoLimpio(body.palabraClave).replace(/\s+/g, " ");
  const vacio = (v: unknown) => v === undefined || v === null || v === "" || v === "todos";
  const categoriaId = vacio(body.categoriaId) ? null : enteroPositivo(body.categoriaId);
  const sinPrecio = vacio(body.precioMaximo);
  const precioMaximo = sinPrecio ? null : Number(body.precioMaximo);

  if (!vacio(body.categoriaId) && !categoriaId) return { error: "La categoría elegida no es válida." };
  if (!palabra && !categoriaId) return { error: "Escribe una palabra clave o elige una categoría para la alerta." };
  if (palabra.length > LARGO_PALABRA) return { error: `La palabra clave puede tener como máximo ${LARGO_PALABRA} caracteres.` };
  if (!sinPrecio && (!(precioMaximo! > 0) || precioMaximo! > PRECIO_MAXIMO)) return { error: "El precio máximo debe ser un número mayor que 0." };
  return { palabraClave: palabra || null, categoriaId, precioMaximo };
}

// ¿La publicación cumple la alerta?
export function cumpleAlerta(alerta: Alerta, oferta: OfertaParaAvisos) {
  if (alerta.CategoriaID && Number(alerta.CategoriaID) !== Number(oferta.categoriaId)) return false;
  if (alerta.PrecioMaximo !== null && alerta.PrecioMaximo !== undefined && Number(oferta.precio) > Number(alerta.PrecioMaximo)) return false;
  if (alerta.PalabraClave) {
    const texto = normalizar(`${oferta.titulo} ${oferta.descripcion || ""}`);
    // Todas las palabras deben aparecer, en cualquier orden: "cuero cafe" encuentra "Cuero vacuno café"
    if (!normalizar(alerta.PalabraClave).split(" ").every((p) => texto.includes(p))) return false;
  }
  return true;
}

// Texto corto que describe una alerta: «cuero» en Suelas, hasta C$500
export function describirAlerta(a: Alerta) {
  const partes = [];
  if (a.PalabraClave) partes.push(`«${a.PalabraClave}»`);
  if (a.NombreCategoria) partes.push(`en ${a.NombreCategoria}`);
  if (a.PrecioMaximo !== null && a.PrecioMaximo !== undefined) partes.push(`hasta C$${Number(a.PrecioMaximo).toLocaleString("es-NI")}`);
  return partes.join(" ");
}
