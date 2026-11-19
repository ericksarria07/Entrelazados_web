// POST /api/pujas: pujar (emprendedor) (de rutas/subastas.js).
// Se valida y actualiza en UNA sola consulta: la subasta debe estar activa, no vencida,
// no ser propia y la puja debe superar el precio actual. Si dos pujas llegan a la vez,
// Postgres hace esperar a la segunda y vuelve a revisar la condición con el precio nuevo.
// El precio nuevo y el historial (tabla pujas) se guardan en la misma transacción.
import { urlPublica } from "@/lib/config";
import { cerrarVencidasSiToca } from "@/lib/cierre-subastas";
import { enTransaccion, obtenerPool } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { type AvisoNotificacion, enviarNotificaciones } from "@/lib/notificaciones";
import { PRECIO_MAXIMO } from "@/lib/ofertas";
import { exigirRoles, exigirSesion } from "@/lib/sesion";
import { nombreLote } from "@/lib/subastas";
import { aTodos } from "@/lib/tiempo-real";
import { cordobas, enteroPositivo } from "@/lib/utilidades";

export const POST = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  exigirRoles(usuario, "emprendedor");
  const b = await leerCuerpo(req);
  const montoPuja = Number(b.montoPuja);
  const emprendedorId = usuario.id;
  if (!b.subastaId || !(montoPuja > 0)) throw new ErrorHttp(400, "Datos de puja incompletos.");
  if (montoPuja > PRECIO_MAXIMO) throw new ErrorHttp(400, "El monto de la puja es demasiado alto.");
  const subastaId = enteroPositivo(b.subastaId);
  if (!subastaId) throw new ErrorHttp(404, "La subasta no existe.");
  // Cierre perezoso, después de responder (la puja ya rechaza las vencidas por su cuenta)
  await cerrarVencidasSiToca(urlPublica(req));

  const aceptada = await enTransaccion(async (c) => {
    const actualizada = await c.query(
      `UPDATE subastas SET precio_actual = $1
       WHERE subasta_id = $2 AND estado = 'Activa' AND fecha_fin > now()
         AND precio_actual < $1 AND proveedor_id <> $3`,
      [montoPuja, subastaId, emprendedorId]
    );
    if (!actualizada.rowCount) return null;
    // Quién iba ganando ANTES de esta puja (el UPDATE ya bloqueó la subasta)
    const {
      rows: [anterior],
    } = await c.query(
      "SELECT emprendedor_id FROM pujas WHERE subasta_id = $1 ORDER BY monto_puja DESC, fecha_puja ASC, puja_id ASC LIMIT 1",
      [subastaId]
    );
    await c.query("INSERT INTO pujas (subasta_id, emprendedor_id, monto_puja) VALUES ($1, $2, $3)", [subastaId, emprendedorId, montoPuja]);
    const {
      rows: [subasta],
    } = await c.query(
      `SELECT s.subasta_id, s.proveedor_id, s.titulo_lote, s.precio_actual,
              (SELECT count(*)::int FROM pujas p WHERE p.subasta_id = s.subasta_id) AS total_pujas
       FROM subastas s WHERE s.subasta_id = $1`,
      [subastaId]
    );
    return { subasta, liderAnterior: (anterior?.emprendedor_id as number | undefined) ?? null };
  });

  if (!aceptada) {
    // No se aceptó: se averigua por qué para dar un mensaje claro
    const {
      rows: [s],
    } = await obtenerPool().query(
      "SELECT precio_actual, estado, fecha_fin, proveedor_id FROM subastas WHERE subasta_id = $1",
      [subastaId]
    );
    if (!s) throw new ErrorHttp(404, "La subasta no existe.");
    if (s.proveedor_id === emprendedorId) throw new ErrorHttp(403, "No puedes pujar en tu propia subasta.");
    if (s.estado === "Cancelada") throw new ErrorHttp(409, "Esta subasta fue cancelada porque el proveedor retiró la publicación.");
    if (s.estado !== "Activa" || new Date(s.fecha_fin) <= new Date()) throw new ErrorHttp(409, "Esta subasta ya finalizó.");
    throw new ErrorHttp(409, `Tu puja debe ser mayor al precio actual de C$${Number(s.precio_actual).toLocaleString("es-NI")}.`, {
      precioActual: Number(s.precio_actual),
    });
  }

  // Después de guardar: anunciar el precio nuevo y avisar a los interesados
  const { subasta, liderAnterior } = aceptada;
  const lote = nombreLote(subasta.titulo_lote);
  const totalPujas = Number(subasta.total_pujas);
  aTodos("puja:nueva", { subastaId: subasta.subasta_id, precioActual: Number(subasta.precio_actual), totalPujas });
  const avisos: AvisoNotificacion[] = [
    {
      usuarioId: subasta.proveedor_id,
      tipo: "PujaRecibida",
      titulo: `Nueva puja en «${lote}»`,
      mensaje: `Tu lote ya va en ${cordobas(montoPuja)} (${totalPujas} puja${totalPujas === 1 ? "" : "s"}).`,
      enlace: "/mercado#tab-auctions",
      referenciaId: subasta.subasta_id,
      agrupar: true,
    },
  ];
  if (liderAnterior && liderAnterior !== emprendedorId) {
    avisos.push({
      usuarioId: liderAnterior,
      tipo: "PujaSuperada",
      titulo: `Te superaron en «${lote}»`,
      mensaje: `Alguien ofreció ${cordobas(montoPuja)}. Puja de nuevo antes de que cierre la subasta.`,
      enlace: "/mercado#tab-auctions",
      referenciaId: subasta.subasta_id,
      agrupar: true,
      correo: {
        asunto: `Te superaron en la subasta: ${lote}`,
        titulo: "Alguien superó tu puja",
        parrafos: [
          `En la subasta «${lote}» ahora hay una puja de ${cordobas(montoPuja)}.`,
          "Si todavía te interesa el lote, entra al Mercado y vuelve a pujar antes de que cierre.",
        ],
        textoBoton: "Ir a las subastas",
      },
    });
  }
  await enviarNotificaciones(avisos, urlPublica(req));
  return json({ message: "¡Tu puja ha sido aceptada exitosamente!" });
});
