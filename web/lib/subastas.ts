// ==========================================================================
// SUBASTAS: piezas compartidas (de servicios/subastas.js)
// El cierre automático de las vencidas llega en la 1.7.
// ==========================================================================
import type { PoolClient } from "pg";
import { correoConfigurado, enviarAviso } from "@/lib/correo";
import { obtenerPool } from "@/lib/db";
import { enviarNotificaciones } from "@/lib/notificaciones";
import { aUsuario } from "@/lib/tiempo-real";
import { after } from "next/server";

// nombreLote vive en lotes.ts (sin dependencias, para las pruebas unitarias)
import { nombreLote } from "@/lib/lotes";
export { nombreLote };

export type AvisoCancelacion = { subastaId: number; emprendedorId: number; lote: string };

// SUBASTAS CANCELADAS CON PUJAS (moderación del administrador o cuenta dada de baja):
// deja un mensaje automático en el chat de cada persona que pujó, dentro de la misma
// transacción (c) que cancela la subasta. El remitente es quien la canceló.
export async function avisarPujadoresCancelacion(
  c: PoolClient,
  { subastaIds, remitenteId, motivo }: { subastaIds: number[]; remitenteId: number; motivo: string }
): Promise<AvisoCancelacion[]> {
  if (!subastaIds.length) return [];
  const { rows } = await c.query<{ subasta_id: number; emprendedor_id: number; titulo_lote: string }>(
    `SELECT DISTINCT p.subasta_id, p.emprendedor_id, s.titulo_lote
     FROM pujas p JOIN subastas s ON s.subasta_id = p.subasta_id
     WHERE p.subasta_id = ANY($1) AND p.emprendedor_id <> $2`,
    [subastaIds, remitenteId]
  );
  const avisos = rows.map((f) => ({ subastaId: f.subasta_id, emprendedorId: f.emprendedor_id, lote: nombreLote(f.titulo_lote) }));
  if (avisos.length > 0) {
    await c.query(
      `INSERT INTO mensajes_chat (remitente_id, destinatario_id, contenido_texto)
       SELECT $1, d, t FROM unnest($2::int[], $3::text[]) AS x(d, t)`,
      [
        remitenteId,
        avisos.map((a) => a.emprendedorId),
        avisos.map(
          (a) =>
            `⚠️ [Aviso automático de EntreLazados] La subasta «${a.lote}» en la que pujaste fue cancelada ${motivo}. ` +
            "Tu puja ya no tiene efecto y no tienes nada que pagar."
        ),
      ]
    );
  }
  return avisos;
}

// Después de confirmar la cancelación: campana, chat en tiempo real y correo. Nunca lanza errores.
export async function avisarCancelacion(avisos: AvisoCancelacion[], motivo: string, urlBase: string | null) {
  if (!avisos.length) return;
  for (const a of avisos) aUsuario(a.emprendedorId, "chat:mensaje", { destinatarioId: a.emprendedorId });
  await enviarNotificaciones(
    avisos.map((a) => ({
      usuarioId: a.emprendedorId,
      tipo: "SubastaCancelada",
      referenciaId: a.subastaId,
      titulo: `Se canceló la subasta «${a.lote}»`,
      mensaje: `Fue cancelada ${motivo}. Tu puja ya no tiene efecto y no tienes nada que pagar.`,
      enlace: "/mercado#tab-auctions",
    })),
    urlBase
  );
  if (!correoConfigurado()) return;
  after(async () => {
    try {
      const { rows } = await obtenerPool().query<{ usuario_id: number; correo_electronico: string }>(
        "SELECT usuario_id, correo_electronico FROM usuarios WHERE usuario_id = ANY($1)",
        [[...new Set(avisos.map((a) => a.emprendedorId))]]
      );
      const porId = new Map(rows.map((u) => [u.usuario_id, u.correo_electronico]));
      const envios = avisos
        .filter((a) => porId.has(a.emprendedorId))
        .map((a) =>
          enviarAviso(porId.get(a.emprendedorId)!, {
            asunto: `Subasta cancelada: ${a.lote}`,
            titulo: "Una subasta en la que pujaste fue cancelada",
            parrafos: [
              `La subasta «${a.lote}» fue cancelada ${motivo}.`,
              "Tu puja ya no tiene efecto y no tienes nada que pagar. Puedes buscar otros lotes en el Mercado.",
            ],
            boton: urlBase ? { texto: "Ir al Mercado", enlace: `${urlBase}/mercado` } : null,
          })
        );
      for (const r of await Promise.allSettled(envios)) {
        if (r.status === "rejected") console.error("⚠️ Aviso de subasta cancelada no enviado:", (r.reason as Error).message);
      }
    } catch (err) {
      console.error("⚠️ Aviso de subasta cancelada no enviado:", (err as Error).message);
    }
  });
}
