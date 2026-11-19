// Tipos y ayudas del Mercado
export type Oferta = {
  OfertaID: number;
  ProveedorID: number;
  TituloMaterial: string;
  Descripcion?: string | null;
  Precio: number | string;
  UnidadMedida: string;
  DistanciaSimuladaKm?: number | null;
  CategoriaID: number;
  NombreCategoria: string;
  NombreProveedor?: string | null;
  CalificacionProveedor?: number | null;
  TotalCalificaciones?: number | null;
  Fotos?: string[];
};
export type Subasta = {
  SubastaID: number;
  ProveedorID: number;
  TituloLote: string;
  NombreCategoria?: string | null;
  TotalPujas: number;
  FechaFin: string;
  PrecioBase: number | string;
  PrecioActual: number | string;
  Foto?: string | null;
};
export type Pagina<T> = { datos: T[]; total: number; pagina: number; paginas: number };
// "Mostrando solo...": una publicación (?oferta=ID) o un proveedor (?proveedor=ID)
export type FiltroFijo = { tipo: "oferta" | "proveedor"; id: number; texto: string } | null;
export type Pestana = "listings" | "auctions" | "map" | "favorites";

export const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

// "Cierra en 3 d 4 h"... (pronto = menos de 24 horas)
export function tiempoRestante(fechaFin: string) {
  const minutos = Math.max(0, Math.floor((new Date(fechaFin).getTime() - Date.now()) / 60000));
  const dias = Math.floor(minutos / 1440),
    horas = Math.floor((minutos % 1440) / 60),
    mins = minutos % 60;
  let texto;
  if (dias > 0) texto = `Cierra en ${dias} d ${horas} h`;
  else if (horas > 0) texto = `Cierra en ${horas} h ${mins} min`;
  else texto = minutos > 0 ? `Cierra en ${mins} min` : "Cerrando…";
  return { texto, pronto: minutos < 1440 };
}
