// ==========================================================================
// MÁQUINA DE ESTADOS DE LOS TRATOS, sin base de datos (la prueban pruebas/unidad/).
//   Pendiente ──► EnProceso ──► Completado
//       │             │
//       └─────────────┴──► Cancelado
// lib/tratos.ts la re-exporta.
// ==========================================================================
import { nombreLote } from "./lotes.ts";

export type Estado = "EnProceso" | "Completado" | "Cancelado";

// A cada estado nuevo solo se puede llegar desde estos estados
export const ESTADOS_ORIGEN: Record<Estado, string[]> = {
  EnProceso: ["Pendiente"],
  Completado: ["Pendiente", "EnProceso"],
  Cancelado: ["Pendiente", "EnProceso"],
};

// "Subasta ganada: Lote Subasta: Cuero café" → "Cuero café"
export const loteDelTrato = (descripcion: unknown) => nombreLote(String(descripcion || "").replace(/^Subasta ganada:\s*/i, ""));
