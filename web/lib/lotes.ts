// ==========================================================================
// NOMBRE DEL LOTE de una subasta, sin dependencias (lo prueban pruebas/unidad/).
// lib/subastas.ts lo re-exporta.
// ==========================================================================
// Las subastas se guardan como "Lote Subasta: <material>"; en avisos se muestra solo el material
export const nombreLote = (titulo: unknown) => String(titulo || "").replace(/^Lote Subasta:\s*/i, "") || "tu lote";
