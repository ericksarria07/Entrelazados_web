// ==========================================================================
// SEGUIMIENTO DE TRATOS (equivale a servicios/tratos.js)
//
// Cuando una subasta cierra con ganador, el trato nace 'Pendiente'. Desde el
// dashboard, el proveedor o el comprador lo avanzan:
//
//   Pendiente ──► EnProceso ──► Completado
//       │             │
//       └─────────────┴──► Cancelado
//
// (también se puede pasar de Pendiente a Completado). Completado y Cancelado son
// finales. La otra parte recibe un mensaje automático en el chat, una notificación
// en la campana y un correo.
//
// CALIFICACIONES: con el trato Completado, cada parte califica a la otra una sola
// vez (1 a 5 estrellas y un comentario opcional).
// ==========================================================================
import { after } from "next/server";
import { correoConfigurado, enviarAviso } from "@/lib/correo";
import { enTransaccion, obtenerPool } from "@/lib/db";
import { ErrorHttp } from "@/lib/http";
import { enviarNotificaciones } from "@/lib/notificaciones";
import { nombreLote } from "@/lib/subastas";
import { aUsuario } from "@/lib/tiempo-real";

type Estado = "EnProceso" | "Completado" | "Cancelado";

// A cada estado nuevo solo se puede llegar desde estos estados
export const ESTADOS_ORIGEN: Record<Estado, string[]> = {
  EnProceso: ["Pendiente"],
  Completado: ["Pendiente", "EnProceso"],
  Cancelado: ["Pendiente", "EnProceso"],
};

const ETIQUETAS: Record<string, string> = {
  Pendiente: "pendiente",
  EnProceso: "en proceso",
  Completado: "completado",
  Cancelado: "cancelado",
};

const LARGO_MAXIMO_MOTIVO = 200;
const LARGO_MAXIMO_COMENTARIO = 300;
const NO_EXISTE = "Ese trato no existe o no participas en él.";

// "Subasta ganada: Lote Subasta: Cuero café" → "Cuero café"
export const loteDelTrato = (descripcion: unknown) => nombreLote(String(descripcion || "").replace(/^Subasta ganada:\s*/i, ""));

const esEstado = (valor: unknown): valor is Estado => typeof valor === "string" && valor in ESTADOS_ORIGEN;

function textoDelChat(estado: Estado, lote: string, motivo: string) {
  if (estado === "EnProceso") {
    return `🚚 [Aviso automático de EntreLazados] Marqué el trato «${lote}» como EN PROCESO: ya acordamos el pago y la entrega.`;
  }
  if (estado === "Completado") {
    return `✅ [Aviso automático de EntreLazados] Marqué el trato «${lote}» como COMPLETADO. ¡Gracias por cerrar el trato en EntreLazados!`;
  }
  return `❌ [Aviso automático de EntreLazados] Cancelé el trato «${lote}».` + (motivo ? ` Motivo: ${motivo}` : "");
}

type FilaTrato = {
  trato_id: number;
  proveedor_id: number;
  emprendedor_id: number;
  descripcion_resumen: string;
  estado_trato: string;
};

// Cambia el estado de un trato en el que participa usuarioId. Lanza ErrorHttp (400, 404 o 409).
export async function cambiarEstado(
  { tratoId, usuarioId, estado, motivo }: { tratoId: number; usuarioId: number; estado: unknown; motivo: unknown },
  urlBase: string | null
) {
  if (!esEstado(estado)) throw new ErrorHttp(400, "Estado no válido. Usa EnProceso, Completado o Cancelado.");
  if (!Number.isInteger(tratoId) || tratoId <= 0) throw new ErrorHttp(404, NO_EXISTE);
  const motivoLimpio = estado === "Cancelado" && typeof motivo === "string" ? motivo.trim().slice(0, LARGO_MAXIMO_MOTIVO) : "";

  const { trato, contraparteId } = await enTransaccion(async (c) => {
    // FOR UPDATE: si las dos partes pulsan a la vez, la segunda ve el estado ya cambiado
    const {
      rows: [trato],
    } = await c.query<FilaTrato>(
      `SELECT trato_id, proveedor_id, emprendedor_id, descripcion_resumen, estado_trato
       FROM tratos_cerrados
       WHERE trato_id = $1 AND (proveedor_id = $2 OR emprendedor_id = $2)
       FOR UPDATE`,
      [tratoId, usuarioId]
    );
    // Mismo mensaje si no existe o si es de otros: no se revela qué tratos existen
    if (!trato) throw new ErrorHttp(404, NO_EXISTE);
    if (trato.estado_trato === estado) throw new ErrorHttp(409, `El trato ya está ${ETIQUETAS[estado]}.`);
    if (!ESTADOS_ORIGEN[estado].includes(trato.estado_trato)) {
      throw new ErrorHttp(409, `Este trato ya está ${ETIQUETAS[trato.estado_trato] || trato.estado_trato} y no se puede cambiar.`);
    }
    await c.query("UPDATE tratos_cerrados SET estado_trato = $1 WHERE trato_id = $2", [estado, tratoId]);
    const contraparteId = trato.proveedor_id === usuarioId ? trato.emprendedor_id : trato.proveedor_id;
    await c.query("INSERT INTO mensajes_chat (remitente_id, destinatario_id, contenido_texto) VALUES ($1, $2, $3)", [
      usuarioId,
      contraparteId,
      textoDelChat(estado, loteDelTrato(trato.descripcion_resumen), motivoLimpio),
    ]);
    return { trato, contraparteId };
  });

  // El correo va después de responder: si falla, el cambio igual queda hecho
  if (correoConfigurado()) {
    after(() =>
      avisarPorCorreo({ trato, usuarioId, contraparteId, estado, motivo: motivoLimpio }, urlBase).catch((err) =>
        console.error("⚠️ Aviso de trato no enviado:", err.message)
      )
    );
  }
  for (const id of [contraparteId, usuarioId]) aUsuario(id, "chat:mensaje", { remitenteId: usuarioId, destinatarioId: contraparteId });
  const lote = loteDelTrato(trato.descripcion_resumen);
  await enviarNotificaciones(
    [
      {
        usuarioId: contraparteId,
        tipo: "TratoActualizado",
        referenciaId: tratoId,
        titulo: `Trato «${lote}»: ${ETIQUETAS[estado]}`,
        mensaje: {
          EnProceso: "La otra parte marcó el trato como en proceso: ya acordaron el pago y la entrega.",
          Completado: "La otra parte marcó el trato como completado. Ya puedes calificarla.",
          Cancelado: "La otra parte canceló el trato." + (motivoLimpio ? ` Motivo: ${motivoLimpio}` : ""),
        }[estado],
        enlace: "dashboard.html",
      },
    ],
    urlBase
  );
  return { tratoId, estadoAnterior: trato.estado_trato, estado, contraparteId };
}

async function avisarPorCorreo(
  { trato, usuarioId, contraparteId, estado, motivo }: { trato: FilaTrato; usuarioId: number; contraparteId: number; estado: Estado; motivo: string },
  urlBase: string | null
) {
  const { rows } = await obtenerPool().query<{ usuario_id: number; correo_electronico: string; nombre: string }>(
    `SELECT u.usuario_id, u.correo_electronico, COALESCE(p.nombre_razon_social, '') AS nombre
     FROM usuarios u LEFT JOIN perfiles_usuarios p ON p.usuario_id = u.usuario_id
     WHERE u.usuario_id = ANY($1)`,
    [[usuarioId, contraparteId]]
  );
  const quien = rows.find((u) => u.usuario_id === usuarioId);
  const destino = rows.find((u) => u.usuario_id === contraparteId);
  if (!destino) return;
  const lote = loteDelTrato(trato.descripcion_resumen);
  const nombre = quien?.nombre || (trato.proveedor_id === usuarioId ? "El proveedor" : "El comprador");
  const parrafos = {
    EnProceso: [`${nombre} marcó el trato «${lote}» como en proceso: ya acordaron el pago y la entrega.`],
    Completado: [`${nombre} marcó el trato «${lote}» como completado.`, "Si todavía falta algo por entregar o pagar, escríbele por el chat."],
    Cancelado: [
      `${nombre} canceló el trato «${lote}».`,
      ...(motivo ? [`Motivo: ${motivo}`] : []),
      "Si no estabas de acuerdo, escríbele por el chat de EntreLazados.",
    ],
  }[estado];
  await enviarAviso(destino.correo_electronico, {
    asunto: `Trato ${ETIQUETAS[estado]}: ${lote}`,
    titulo: `Trato ${ETIQUETAS[estado]}`,
    parrafos,
    boton: urlBase ? { texto: "Ver mis tratos", enlace: `${urlBase}/dashboard.html` } : null,
  });
}

// Califica a la otra parte de un trato completado. Lanza ErrorHttp (400, 404 o 409).
export async function calificar(
  { tratoId, usuarioId, puntuacion, comentario }: { tratoId: number; usuarioId: number; puntuacion: unknown; comentario: unknown },
  urlBase: string | null
) {
  const estrellas = Number(puntuacion);
  if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) throw new ErrorHttp(400, "La calificación debe ser de 1 a 5 estrellas.");
  if (!Number.isInteger(tratoId) || tratoId <= 0) throw new ErrorHttp(404, NO_EXISTE);
  const comentarioLimpio = typeof comentario === "string" ? comentario.trim().slice(0, LARGO_MAXIMO_COMENTARIO) : "";

  const resultado = await enTransaccion(async (c) => {
    const {
      rows: [trato],
    } = await c.query<FilaTrato>(
      `SELECT trato_id, proveedor_id, emprendedor_id, descripcion_resumen, estado_trato
       FROM tratos_cerrados
       WHERE trato_id = $1 AND (proveedor_id = $2 OR emprendedor_id = $2)
       FOR UPDATE`,
      [tratoId, usuarioId]
    );
    if (!trato) throw new ErrorHttp(404, NO_EXISTE);
    if (trato.estado_trato !== "Completado") throw new ErrorHttp(409, "Solo puedes calificar un trato completado.");
    const calificadoId = trato.proveedor_id === usuarioId ? trato.emprendedor_id : trato.proveedor_id;
    // ON CONFLICT: la llave única (trato, autor) impide calificar dos veces
    const insertada = await c.query(
      `INSERT INTO calificaciones (trato_id, autor_id, calificado_id, puntuacion, comentario)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT ON CONSTRAINT uq_calificaciones_trato_autor DO NOTHING`,
      [tratoId, usuarioId, calificadoId, estrellas, comentarioLimpio || null]
    );
    if (!insertada.rowCount) throw new ErrorHttp(409, "Ya calificaste este trato.");
    const lote = loteDelTrato(trato.descripcion_resumen);
    await c.query("INSERT INTO mensajes_chat (remitente_id, destinatario_id, contenido_texto) VALUES ($1, $2, $3)", [
      usuarioId,
      calificadoId,
      `⭐ [Aviso automático de EntreLazados] Califiqué el trato «${lote}» con ${estrellas} de 5 estrellas.` +
        (comentarioLimpio ? ` Comentario: ${comentarioLimpio}` : ""),
    ]);
    return { tratoId, puntuacion: estrellas, calificadoId, lote };
  });

  const { lote, ...respuesta } = resultado;
  for (const id of [respuesta.calificadoId, usuarioId]) {
    aUsuario(id, "chat:mensaje", { remitenteId: usuarioId, destinatarioId: respuesta.calificadoId });
  }
  await enviarNotificaciones(
    [
      {
        usuarioId: respuesta.calificadoId,
        tipo: "CalificacionRecibida",
        referenciaId: tratoId,
        titulo: `Te calificaron con ${"★".repeat(estrellas)}${"☆".repeat(5 - estrellas)}`,
        mensaje: `Por el trato «${lote}».` + (comentarioLimpio ? ` "${comentarioLimpio}"` : ""),
        enlace: "perfil.html",
      },
    ],
    urlBase
  );
  return respuesta;
}

// Datos del comprobante de un trato (comprobante.html). Lo pueden ver las dos partes
// y el administrador; a cualquier otra persona se le responde 404.
export async function comprobante({ tratoId, usuarioId, esAdmin = false }: { tratoId: number; usuarioId: number; esAdmin?: boolean }) {
  if (!Number.isInteger(tratoId) || tratoId <= 0) throw new ErrorHttp(404, NO_EXISTE);
  const pool = obtenerPool();
  const {
    rows: [t],
  } = await pool.query(
    `SELECT trato_id, proveedor_id, emprendedor_id, tipo_origen, origen_id, descripcion_resumen, monto_total, estado_trato, fecha_cierre
     FROM tratos_cerrados WHERE trato_id = $1`,
    [tratoId]
  );
  if (!t || (!esAdmin && t.proveedor_id !== usuarioId && t.emprendedor_id !== usuarioId)) throw new ErrorHttp(404, NO_EXISTE);
  const { rows: partes } = await pool.query(
    `SELECT u.usuario_id, u.correo_electronico, p.nombre_razon_social, p.telefono_whatsapp, p.direccion_exacta,
            d.nombre_departamento, prov.numero_ruc, prov.nombre_comercial, emp.nombre_marca
     FROM usuarios u
     LEFT JOIN perfiles_usuarios p ON p.usuario_id = u.usuario_id
     LEFT JOIN departamentos d ON d.departamento_id = p.departamento_id
     LEFT JOIN proveedores prov ON prov.usuario_id = u.usuario_id
     LEFT JOIN emprendedores emp ON emp.usuario_id = u.usuario_id
     WHERE u.usuario_id = ANY($1)`,
    [[t.proveedor_id, t.emprendedor_id]]
  );
  const parte = (id: number, rol: "Proveedor" | "Emprendedor") => {
    const f = partes.find((x) => x.usuario_id === id) || {};
    return {
      id,
      rol,
      nombre: f.nombre_razon_social || "Usuario eliminado",
      nombreComercial: (rol === "Proveedor" ? f.nombre_comercial : f.nombre_marca) || null,
      ruc: rol === "Proveedor" ? f.numero_ruc || null : null,
      correo: f.correo_electronico || null,
      telefono: f.telefono_whatsapp || null,
      departamento: f.nombre_departamento || null,
      direccion: f.direccion_exacta || null,
    };
  };

  let subasta = null;
  if (t.tipo_origen === "Subasta" && t.origen_id) {
    const {
      rows: [s],
    } = await pool.query(
      `SELECT s.subasta_id, s.titulo_lote, s.precio_base, s.fecha_inicio, s.fecha_fin, c.nombre_categoria,
              (SELECT count(*)::int FROM pujas p WHERE p.subasta_id = s.subasta_id) AS pujas
       FROM subastas s LEFT JOIN categorias_materiales c ON c.categoria_id = s.categoria_id
       WHERE s.subasta_id = $1`,
      [t.origen_id]
    );
    if (s) {
      subasta = {
        id: s.subasta_id,
        lote: nombreLote(s.titulo_lote),
        categoria: s.nombre_categoria || null,
        precioBase: Number(s.precio_base),
        pujas: s.pujas,
        inicio: s.fecha_inicio,
        cierre: s.fecha_fin,
      };
    }
  }

  return {
    folio: `EL-${String(t.trato_id).padStart(6, "0")}`,
    tratoId: t.trato_id,
    origen: t.tipo_origen,
    concepto: subasta ? subasta.lote : loteDelTrato(t.descripcion_resumen),
    monto: Number(t.monto_total),
    moneda: "NIO",
    estado: t.estado_trato,
    fechaCierre: t.fecha_cierre,
    emitido: new Date(),
    proveedor: parte(t.proveedor_id, "Proveedor"),
    comprador: parte(t.emprendedor_id, "Emprendedor"),
    subasta,
  };
}
