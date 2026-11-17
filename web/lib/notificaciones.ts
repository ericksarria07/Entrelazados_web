// ==========================================================================
// NOTIFICACIONES: la campana del menú (equivale a servicios/notificaciones.js)
//
// Cada aviso se guarda en la tabla notificaciones y se empuja a las páginas abiertas
// del usuario (tiempo real, 1.6). Si trae "correo", también se manda por correo.
//
//   await enviarNotificaciones([{
//       usuarioId: 12, tipo: 'PujaSuperada',
//       titulo: 'Te superaron en una subasta', mensaje: 'Alguien ofreció C$540...',
//       enlace: 'mercado.html#tab-auctions', referenciaId: 8,
//       agrupar: true,     // si ya hay uno igual SIN LEER, se actualiza en vez de crear otro
//       correo: { asunto, titulo, parrafos, textoBoton }   // opcional
//   }], urlPublica(req));
//
// Nunca lanza errores: un aviso que falla queda en el log, pero la acción principal
// (la puja, la cancelación...) ya quedó guardada. Se llama DESPUÉS del COMMIT.
// ==========================================================================
import { correoConfigurado, enviarAviso } from "@/lib/correo";
import { obtenerPool } from "@/lib/db";
import { aUsuario } from "@/lib/tiempo-real";
import { after } from "next/server";

export const TIPOS: Record<string, string> = {
  PujaSuperada: "Te superaron en una puja",
  PujaRecibida: "Nueva puja en tu subasta",
  SubastaGanada: "Ganaste una subasta",
  SubastaTerminada: "Una subasta terminó",
  SubastaCancelada: "Una subasta fue cancelada",
  TratoActualizado: "Un trato cambió de estado",
  CalificacionRecibida: "Recibiste una calificación",
  AlertaBusqueda: "Se publicó algo que buscabas",
  FavoritoRebajado: "Un favorito bajó de precio",
};

export type AvisoNotificacion = {
  usuarioId: number;
  tipo: string;
  titulo?: string;
  mensaje?: string;
  enlace?: string | null;
  referenciaId?: number | null;
  agrupar?: boolean;
  correo?: { asunto?: string; titulo?: string; parrafos?: string[]; textoBoton?: string };
};

type FilaNotificacion = {
  notificacion_id: number;
  tipo: string;
  titulo: string;
  mensaje: string;
  enlace: string | null;
  referencia_id: number | null;
  es_leida: boolean;
  fecha_creacion: Date;
};

const recortar = (texto: unknown, largo: number) => String(texto || "").slice(0, largo);

// Fila de la base → lo que recibe el navegador
export const aJson = (f: FilaNotificacion) => ({
  id: f.notificacion_id,
  tipo: f.tipo,
  titulo: f.titulo,
  mensaje: f.mensaje,
  enlace: f.enlace,
  referenciaId: f.referencia_id,
  leida: !!f.es_leida,
  fecha: f.fecha_creacion,
});

// Guarda un aviso (o actualiza el que ya estaba sin leer) y devuelve { fila, nueva }
async function guardar(a: AvisoNotificacion): Promise<{ fila: FilaNotificacion; nueva: boolean }> {
  const pool = obtenerPool();
  const titulo = recortar(a.titulo || TIPOS[a.tipo] || "Aviso", 120);
  const mensaje = recortar(a.mensaje, 300);
  if (a.agrupar && a.referenciaId) {
    const { rows } = await pool.query<FilaNotificacion>(
      `UPDATE notificaciones SET titulo = $1, mensaje = $2, enlace = $3, fecha_creacion = now()
       WHERE notificacion_id = (
         SELECT notificacion_id FROM notificaciones
         WHERE usuario_id = $4 AND tipo = $5 AND referencia_id = $6 AND es_leida = false
         ORDER BY notificacion_id DESC LIMIT 1)
       RETURNING *`,
      [titulo, mensaje, a.enlace || null, a.usuarioId, a.tipo, a.referenciaId]
    );
    if (rows[0]) return { fila: rows[0], nueva: false };
  }
  const { rows } = await pool.query<FilaNotificacion>(
    `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, enlace, referencia_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [a.usuarioId, a.tipo, titulo, mensaje, a.enlace || null, a.referenciaId || null]
  );
  return { fila: rows[0], nueva: true };
}

export async function enviarNotificaciones(avisos: AvisoNotificacion[], urlBase: string | null = null): Promise<void> {
  const lista = (avisos || []).filter((a) => a && a.usuarioId && a.tipo);
  const conCorreo: AvisoNotificacion[] = [];
  for (const aviso of lista) {
    try {
      const { fila, nueva } = await guardar(aviso);
      aUsuario(aviso.usuarioId, "notificacion:nueva", aJson(fila));
      // Si se agrupó con uno que ya estaba sin leer, no se repite el correo
      if (aviso.correo && nueva) conCorreo.push(aviso);
    } catch (err) {
      console.error(
        `⚠️ No se pudo guardar la notificación ${aviso.tipo} para el usuario ${aviso.usuarioId}:`,
        (err as Error).message
      );
    }
  }
  if (conCorreo.length > 0 && correoConfigurado()) {
    after(() =>
      avisarPorCorreo(conCorreo, urlBase).catch((err) => console.error("⚠️ Notificación por correo no enviada:", err.message))
    );
  }
}

async function avisarPorCorreo(avisos: AvisoNotificacion[], urlBase: string | null) {
  const { rows: usuarios } = await obtenerPool().query<{ usuario_id: number; correo_electronico: string }>(
    "SELECT usuario_id, correo_electronico FROM usuarios WHERE usuario_id = ANY($1)",
    [[...new Set(avisos.map((a) => a.usuarioId))]]
  );
  const porId = new Map(usuarios.map((u) => [u.usuario_id, u.correo_electronico]));
  const envios = avisos
    .filter((a) => porId.has(a.usuarioId))
    .map((a) =>
      enviarAviso(porId.get(a.usuarioId)!, {
        asunto: a.correo!.asunto || a.titulo || "Aviso",
        titulo: a.correo!.titulo || a.titulo || "Aviso",
        parrafos: a.correo!.parrafos || [a.mensaje || ""],
        boton:
          urlBase && a.enlace ? { texto: a.correo!.textoBoton || "Abrir EntreLazados", enlace: `${urlBase}/${a.enlace}` } : null,
      })
    );
  for (const r of await Promise.allSettled(envios)) {
    if (r.status === "rejected") console.error("⚠️ Notificación por correo no enviada:", (r.reason as Error).message);
  }
}

// ---------------------------------------------------------- CONSULTAS (app/api/notificaciones)
export async function listarNotificaciones(usuarioId: number, limite = 30) {
  const pool = obtenerPool();
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    pool.query<FilaNotificacion>(
      "SELECT * FROM notificaciones WHERE usuario_id = $1 ORDER BY fecha_creacion DESC, notificacion_id DESC LIMIT $2",
      [usuarioId, limite]
    ),
    pool.query("SELECT count(*)::int AS total FROM notificaciones WHERE usuario_id = $1 AND es_leida = false", [usuarioId]),
  ]);
  return { noLeidas: total as number, notificaciones: rows.map(aJson) };
}

// Devuelve true si la marcó (false si no existe o es de otro usuario)
export async function marcarLeida(usuarioId: number, notificacionId: number): Promise<boolean> {
  const r = await obtenerPool().query("UPDATE notificaciones SET es_leida = true WHERE notificacion_id = $1 AND usuario_id = $2", [
    notificacionId,
    usuarioId,
  ]);
  return (r.rowCount ?? 0) > 0;
}

export async function marcarTodasLeidas(usuarioId: number): Promise<number> {
  const r = await obtenerPool().query("UPDATE notificaciones SET es_leida = true WHERE usuario_id = $1 AND es_leida = false", [usuarioId]);
  return r.rowCount ?? 0;
}
