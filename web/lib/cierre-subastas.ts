// ==========================================================================
// CIERRE DE SUBASTAS VENCIDAS (equivale a crearCierreSubastas de servicios/subastas.js)
//
// Para cada subasta 'Activa' cuya fecha_fin ya pasó:
//   1. se marca 'Finalizada';
//   2. si tuvo pujas, gana la más alta: se registra el trato (estado 'Pendiente')
//      y se abre el chat entre proveedor y ganador con un mensaje automático;
//   3. se avisa por correo al proveedor y al ganador;
//   4. se notifica (campana) al ganador, al proveedor y a los demás que pujaron.
//
// Cuándo corre (en Vercel no hay procesos que corran cada minuto):
//   * CIERRE PEREZOSO: cerrarVencidasSiToca() al listar subastas, pujar, ver tratos
//     o abrir el dashboard. Como mucho una vez cada 15 s por instancia.
//   * CRON DIARIO de Vercel (vercel.json → /api/cron/cerrar-subastas), para las
//     que nadie miró.
//   * A mano: POST /api/admin/subastas/cerrar-vencidas.
// CIERRE_PEREZOSO=0 lo apaga (las pruebas cierran con la ruta del admin).
//
// Todo lo de una subasta va en una transacción con SELECT ... FOR UPDATE: si dos
// instancias cierran a la vez, la segunda ya no la ve 'Activa' y no repite nada.
// ==========================================================================
import { after } from "next/server";
import { correoConfigurado, enviarAviso } from "@/lib/correo";
import { obtenerPool } from "@/lib/db";
import { type AvisoNotificacion, enviarNotificaciones } from "@/lib/notificaciones";
import { nombreLote } from "@/lib/subastas";
import { aTodos, aUsuario } from "@/lib/tiempo-real";
import { cordobas } from "@/lib/utilidades";

export type SubastaCerrada = {
  subastaId: number;
  lote: string;
  proveedorId: number;
  ganadorId: number | null;
  monto: number | null;
  tratoId: number | null;
};

const ESPERA_PEREZOSO_MS = 15 * 1000;
let enCurso = false;
let ultimaRevision = 0;

// Cierra las subastas vencidas. Devuelve la lista de las que cerró.
export async function cerrarVencidas(urlBase: string | null = null): Promise<SubastaCerrada[]> {
  if (enCurso) return []; // evita que dos ejecuciones se crucen en la misma instancia
  enCurso = true;
  const cerradas: SubastaCerrada[] = [];
  const participantes = new Map<number, number[]>();
  const c = await obtenerPool().connect();
  try {
    const { rows: vencidas } = await c.query<{ subasta_id: number }>(
      "SELECT subasta_id FROM subastas WHERE estado = 'Activa' AND fecha_fin <= now() ORDER BY fecha_fin LIMIT 200"
    );
    for (const { subasta_id: subastaId } of vencidas) {
      try {
        await c.query("BEGIN");
        const {
          rows: [subasta],
        } = await c.query(
          "SELECT subasta_id, proveedor_id, titulo_lote FROM subastas WHERE subasta_id = $1 AND estado = 'Activa' FOR UPDATE",
          [subastaId]
        );
        if (!subasta) {
          await c.query("ROLLBACK");
          continue;
        }
        // Gana la puja más alta; si hubiera empate, la que llegó primero
        const {
          rows: [ganadora],
        } = await c.query(
          "SELECT emprendedor_id, monto_puja FROM pujas WHERE subasta_id = $1 ORDER BY monto_puja DESC, fecha_puja ASC, puja_id ASC LIMIT 1",
          [subastaId]
        );
        await c.query("UPDATE subastas SET estado = 'Finalizada' WHERE subasta_id = $1", [subastaId]);
        const { rows: pujadores } = await c.query<{ emprendedor_id: number }>(
          "SELECT DISTINCT emprendedor_id FROM pujas WHERE subasta_id = $1",
          [subastaId]
        );

        let tratoId: number | null = null;
        if (ganadora) {
          const {
            rows: [trato],
          } = await c.query(
            `INSERT INTO tratos_cerrados (proveedor_id, emprendedor_id, tipo_origen, origen_id, descripcion_resumen, monto_total, estado_trato)
             VALUES ($1, $2, 'Subasta', $3, $4, $5, 'Pendiente') RETURNING trato_id`,
            [subasta.proveedor_id, ganadora.emprendedor_id, subastaId, `Subasta ganada: ${subasta.titulo_lote}`.slice(0, 255), ganadora.monto_puja]
          );
          tratoId = trato.trato_id;
          await c.query("INSERT INTO mensajes_chat (remitente_id, destinatario_id, contenido_texto) VALUES ($1, $2, $3)", [
            subasta.proveedor_id,
            ganadora.emprendedor_id,
            `🎉 [Mensaje automático de EntreLazados] ¡Felicidades! Ganaste la subasta «${nombreLote(subasta.titulo_lote)}» ` +
              `con una puja de ${cordobas(ganadora.monto_puja)}. Escríbeme por aquí para coordinar el pago y la entrega.`,
          ]);
        }
        await c.query("COMMIT");
        participantes.set(subastaId, pujadores.map((p) => p.emprendedor_id));
        cerradas.push({
          subastaId,
          lote: nombreLote(subasta.titulo_lote),
          proveedorId: subasta.proveedor_id,
          ganadorId: ganadora ? ganadora.emprendedor_id : null,
          monto: ganadora ? Number(ganadora.monto_puja) : null,
          tratoId,
        });
      } catch (err) {
        await c.query("ROLLBACK").catch(() => {});
        console.error(`❌ No se pudo cerrar la subasta ${subastaId}:`, (err as Error).message);
      }
    }
  } finally {
    c.release();
    enCurso = false;
  }

  if (cerradas.length > 0) {
    const conGanador = cerradas.filter((x) => x.ganadorId).length;
    console.log(`🔨 Subastas cerradas: ${cerradas.length} (${conGanador} con ganador, ${cerradas.length - conGanador} sin pujas)`);
    if (correoConfigurado()) {
      after(() => avisarPorCorreo(cerradas, urlBase).catch((err) => console.error("⚠️ Error al avisar el cierre de subastas:", err.message)));
    }
    aTodos("subastas:cambio", { motivo: "cerrada" });
    await notificarCierre(cerradas, participantes, urlBase);
  }
  return cerradas;
}

// Cierre perezoso: como mucho una vez cada 15 s por instancia. Nunca lanza errores.
// esperar=false lo deja para después de responder (no demora la página).
export async function cerrarVencidasSiToca(urlBase: string | null, { esperar = false } = {}): Promise<void> {
  if (process.env.CIERRE_PEREZOSO === "0") return;
  if (Date.now() - ultimaRevision < ESPERA_PEREZOSO_MS) return;
  ultimaRevision = Date.now();
  const tarea = () =>
    cerrarVencidas(urlBase).then(
      () => undefined,
      (err) => console.error("❌ Error al cerrar subastas vencidas:", (err as Error).message)
    );
  if (esperar) await tarea();
  else after(tarea);
}

// Campana y chat en tiempo real para cada subasta cerrada
async function notificarCierre(cerradas: SubastaCerrada[], participantes: Map<number, number[]>, urlBase: string | null) {
  const avisos: AvisoNotificacion[] = [];
  for (const x of cerradas) {
    if (x.ganadorId) {
      // El mensaje automático del chat va del proveedor al ganador
      for (const id of [x.ganadorId, x.proveedorId]) {
        aUsuario(id, "chat:mensaje", { remitenteId: x.proveedorId, destinatarioId: x.ganadorId });
      }
      avisos.push(
        {
          usuarioId: x.ganadorId,
          tipo: "SubastaGanada",
          referenciaId: x.subastaId,
          titulo: `¡Ganaste «${x.lote}»! 🎉`,
          mensaje: `Tu puja de ${cordobas(x.monto)} fue la más alta. El proveedor ya te escribió por el chat para coordinar el pago y la entrega.`,
          enlace: "chat.html",
        },
        {
          usuarioId: x.proveedorId,
          tipo: "SubastaTerminada",
          referenciaId: x.subastaId,
          titulo: `Tu subasta «${x.lote}» tiene ganador`,
          mensaje: `Terminó con una puja de ${cordobas(x.monto)}. Coordina el pago y la entrega desde el chat.`,
          enlace: "dashboard.html",
        }
      );
      for (const otro of (participantes.get(x.subastaId) || []).filter((id) => id !== x.ganadorId)) {
        avisos.push({
          usuarioId: otro,
          tipo: "SubastaTerminada",
          referenciaId: x.subastaId,
          titulo: `Terminó la subasta «${x.lote}»`,
          mensaje: `Ganó una puja de ${cordobas(x.monto)}. Puedes buscar otros lotes en el Mercado.`,
          enlace: "mercado.html#tab-auctions",
        });
      }
    } else {
      avisos.push({
        usuarioId: x.proveedorId,
        tipo: "SubastaTerminada",
        referenciaId: x.subastaId,
        titulo: `Tu subasta «${x.lote}» terminó sin pujas`,
        mensaje: "Puedes volver a publicar el material desde el Mercado para abrir una nueva subasta.",
        enlace: "mercado.html",
      });
    }
  }
  await enviarNotificaciones(avisos, urlBase);
}

// Correos al proveedor y al ganador (o al proveedor si no hubo pujas)
async function avisarPorCorreo(cerradas: SubastaCerrada[], urlBase: string | null) {
  const ids = [...new Set(cerradas.flatMap((x) => [x.proveedorId, x.ganadorId]).filter(Boolean))];
  const { rows } = await obtenerPool().query<{ usuario_id: number; correo_electronico: string; nombre: string }>(
    `SELECT u.usuario_id, u.correo_electronico, COALESCE(p.nombre_razon_social, '') AS nombre
     FROM usuarios u LEFT JOIN perfiles_usuarios p ON p.usuario_id = u.usuario_id
     WHERE u.usuario_id = ANY($1)`,
    [ids]
  );
  const porId = new Map(rows.map((u) => [u.usuario_id, u]));
  const enlaceChat = urlBase ? { texto: "Abrir el chat", enlace: `${urlBase}/chat.html` } : null;
  const enlaceDashboard = urlBase ? { texto: "Ver mi dashboard", enlace: `${urlBase}/dashboard.html` } : null;

  for (const x of cerradas) {
    const proveedor = porId.get(x.proveedorId);
    const ganador = x.ganadorId ? porId.get(x.ganadorId) : null;
    const envios: Promise<unknown>[] = [];
    if (proveedor && ganador) {
      envios.push(
        enviarAviso(proveedor.correo_electronico, {
          asunto: `Tu subasta terminó: ${x.lote}`,
          titulo: "¡Tu subasta tiene ganador!",
          parrafos: [
            `La subasta «${x.lote}» terminó con una puja ganadora de ${cordobas(x.monto)} de ${ganador.nombre || "un emprendedor"}.`,
            "Le enviamos un mensaje en tu nombre para abrir la conversación. Coordina el pago y la entrega desde el chat de EntreLazados.",
          ],
          boton: enlaceChat,
        }),
        enviarAviso(ganador.correo_electronico, {
          asunto: `Ganaste la subasta: ${x.lote}`,
          titulo: "¡Ganaste la subasta! 🎉",
          parrafos: [
            `Tu puja de ${cordobas(x.monto)} fue la más alta en «${x.lote}».`,
            `${proveedor.nombre || "El proveedor"} ya te escribió por el chat de EntreLazados para coordinar el pago y la entrega.`,
          ],
          boton: enlaceChat,
        })
      );
    } else if (proveedor) {
      envios.push(
        enviarAviso(proveedor.correo_electronico, {
          asunto: `Tu subasta terminó sin pujas: ${x.lote}`,
          titulo: "Tu subasta terminó",
          parrafos: [
            `La subasta «${x.lote}» llegó a su fecha de cierre sin recibir pujas.`,
            "Puedes volver a publicar el material desde el Mercado para abrir una nueva subasta.",
          ],
          boton: enlaceDashboard,
        })
      );
    }
    for (const r of await Promise.allSettled(envios)) {
      if (r.status === "rejected") console.error("⚠️ Aviso de subasta no enviado:", (r.reason as Error).message);
    }
  }
}
