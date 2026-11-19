// ==========================================================================
// MIS SUBASTAS CERRADAS (dashboard): el emprendedor ve las que ganó y el proveedor
// las que vendió, con el chat para coordinar la entrega, el comprobante, botones
// para marcar cómo va el trato y, al completarlo, la calificación.
// ==========================================================================
"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, conJSON } from "@/lib/cliente/api";
import { dinero, estrellasFijas, haceCuanto } from "./formatos";

type Trato = {
  id: number;
  estado: string;
  descripcion: string;
  soyProveedor: boolean;
  contraparte: string;
  contraparteId: number;
  fecha: string;
  monto: number;
  miCalificacion?: number | null;
  suCalificacion?: number | null;
};
type Pagina = { datos: Trato[]; total: number; pagina: number; paginas: number };

const ESTADOS: Record<string, { texto: string; icono: string; clase: string }> = {
  Pendiente: { texto: "Pendiente", icono: "ti-hourglass", clase: "pendiente" },
  EnProceso: { texto: "En proceso", icono: "ti-truck-delivery", clase: "proceso" },
  Completado: { texto: "Completado", icono: "ti-circle-check", clase: "completado" },
  Cancelado: { texto: "Cancelado", icono: "ti-circle-x", clase: "cancelado" },
};
// Qué botones se ofrecen según el estado actual (Completado y Cancelado son finales)
const ACCIONES: Record<string, { estado: string; texto: string; icono: string; principal?: boolean }[]> = {
  Pendiente: [
    { estado: "EnProceso", texto: "Pago y entrega acordados", icono: "ti-truck-delivery", principal: true },
    { estado: "Completado", texto: "Completado", icono: "ti-circle-check" },
    { estado: "Cancelado", texto: "Cancelar", icono: "ti-x" },
  ],
  EnProceso: [
    { estado: "Completado", texto: "Marcar completado", icono: "ti-circle-check", principal: true },
    { estado: "Cancelado", texto: "Cancelar", icono: "ti-x" },
  ],
};
const POR_PAGINA = 5;

export default function MisTratos({
  rol,
  avisar,
  alCancelar,
}: {
  rol: string;
  avisar: (texto: string, error?: boolean) => void;
  alCancelar: () => void;
}) {
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<Pagina | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  const cargar = useCallback(async (p: number): Promise<void> => {
    try {
      const res = await api(`/api/tratos?origen=Subasta&pagina=${p}&porPagina=${POR_PAGINA}`);
      if (!res.ok) throw new Error("sin datos");
      const d = (await res.json()) as Pagina;
      if (d.datos.length === 0 && d.total > 0 && p > 1) {
        setPagina(d.paginas);
        return;
      }
      setDatos(d);
    } catch {
      setDatos(null);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => cargar(pagina), 0);
    return () => clearTimeout(t);
  }, [cargar, pagina, version]);

  async function calificar(id: number, puntuacion: number) {
    const comentario = prompt(
      `Vas a dar ${puntuacion} estrella${puntuacion === 1 ? "" : "s"}. Puedes escribir un comentario (opcional, máximo 300 letras):`,
      ""
    );
    if (comentario === null) return;
    setOcupado(id);
    try {
      const res = await api(`/api/tratos/${id}/calificacion`, conJSON("POST", { puntuacion, comentario: comentario.trim() }));
      const r = (await res.json().catch(() => ({}))) as { message?: string };
      avisar(r.message || (res.ok ? "¡Gracias por calificar!" : "No se pudo guardar la calificación."), !res.ok);
      setVersion((v) => v + 1);
    } catch {
      avisar("Error de conexión con el servidor.", true);
    } finally {
      setOcupado(null);
    }
  }

  async function cambiarEstado(id: number, estado: string) {
    const cuerpo: { estado: string; motivo?: string } = { estado };
    if (estado === "Cancelado") {
      const motivo = prompt("¿Seguro que quieres cancelar este trato? Puedes escribir el motivo (opcional):", "");
      if (motivo === null) return;
      cuerpo.motivo = motivo.trim();
    } else if (estado === "Completado") {
      if (!confirm("¿Confirmas que el material ya se entregó y se pagó?")) return;
    }
    setOcupado(id);
    try {
      const res = await api(`/api/tratos/${id}/estado`, conJSON("PUT", cuerpo));
      const r = (await res.json().catch(() => ({}))) as { message?: string };
      avisar(r.message || (res.ok ? "Trato actualizado." : "No se pudo actualizar el trato."), !res.ok);
      // Cancelar cambia los totales de "Mi actividad": se recarga todo
      if (res.ok && estado === "Cancelado") alCancelar();
      setVersion((v) => v + 1);
    } catch {
      avisar("Error de conexión con el servidor.", true);
    } finally {
      setOcupado(null);
    }
  }

  if (!datos || !datos.datos.length) return null;

  return (
    <div className="mis-tratos" id="misTratos">
      <h3>
        <i className="ti ti-gavel" aria-hidden="true" />{" "}
        <span id="tituloMisTratos">{rol === "proveedor" ? "Mis subastas vendidas" : "Mis subastas ganadas"}</span>
      </h3>
      <p className="nota-tratos" style={{ fontSize: 12, color: "#e3cfc4", margin: "-4px 0 8px" }}>
        Marca cómo va cada trato: la otra parte recibe un aviso en el chat.
      </p>
      <div id="listaMisTratos">
        {datos.datos.map((t) => {
          const estado = ESTADOS[t.estado] || { texto: t.estado, icono: "ti-info-circle", clase: "pendiente" };
          const acciones = ACCIONES[t.estado] || [];
          const id = Number(t.id);
          const mia = Number(t.miCalificacion) || 0;
          const suya = Number(t.suCalificacion) || 0;
          const bloqueado = ocupado === id;
          return (
            <div className={`trato ${acciones.length ? "" : "cerrado"}`} data-trato={id} key={id}>
              <div className="trato-info">
                <strong>{t.descripcion.replace(/^Subasta ganada:\s*(Lote Subasta:\s*)?/i, "")}</strong>
                <span>
                  {t.soyProveedor ? "Comprador" : "Proveedor"}:{" "}
                  <Link className="enlace-perfil" href={`/perfil-publico?id=${Number(t.contraparteId)}`} title="Ver su perfil público">
                    {t.contraparte}
                  </Link>{" "}
                  · {haceCuanto(t.fecha)}
                </span>
              </div>
              <div className="trato-lado">
                <span className={`estado-trato ${estado.clase}`}>
                  <i className={`ti ${estado.icono}`} aria-hidden="true" /> {estado.texto}
                </span>
                <span className="trato-monto">{dinero(t.monto)}</span>
              </div>
              <div className="trato-acciones">
                <Link href={`/chat?contacto=${Number(t.contraparteId)}`}>
                  <i className="ti ti-message-circle" aria-hidden="true" /> {acciones.length ? "Coordinar" : "Chat"}
                </Link>
                <a
                  href={`/comprobante?trato=${id}`}
                  target="_blank"
                  rel="noopener"
                  title="Abrir el comprobante para imprimirlo o guardarlo como PDF"
                >
                  <i className="ti ti-file-invoice" aria-hidden="true" /> Comprobante
                </a>
                {acciones.map((a) => (
                  <button
                    key={a.estado}
                    type="button"
                    className={a.principal ? "principal" : ""}
                    disabled={bloqueado}
                    onClick={() => cambiarEstado(id, a.estado)}
                  >
                    <i className={`ti ${a.icono}`} aria-hidden="true" /> {a.texto}
                  </button>
                ))}
                {/* Trato completado: cada parte califica a la otra una vez */}
                {t.estado === "Completado" &&
                  (mia ? (
                    <span className="trato-calificacion">
                      Tu calificación: <span className="estrellas-fijas">{estrellasFijas(mia)}</span>
                    </span>
                  ) : (
                    <span className="trato-calificacion">
                      Califica a {t.contraparte}:
                      <span className="trato-estrellas">
                        {[5, 4, 3, 2, 1].map((n) => (
                          <button
                            key={n}
                            type="button"
                            className="estrella"
                            disabled={bloqueado}
                            title={`${n} estrella${n === 1 ? "" : "s"}`}
                            aria-label={`${n} estrella${n === 1 ? "" : "s"}`}
                            onClick={() => calificar(id, n)}
                          >
                            ★
                          </button>
                        ))}
                      </span>
                    </span>
                  ))}
                {t.estado === "Completado" && suya > 0 && (
                  <span className="trato-calificacion">
                    Te calificó: <span className="estrellas-fijas">{estrellasFijas(suya)}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="paginacion-tratos" id="paginacionMisTratos">
        {datos.paginas > 1 && (
          <>
            <button type="button" disabled={datos.pagina <= 1} onClick={() => setPagina(datos.pagina - 1)} aria-label="Tratos anteriores">
              <i className="ti ti-chevron-left" aria-hidden="true" /> Anterior
            </button>
            <span>
              {datos.pagina} de {datos.paginas} · {datos.total} trato{datos.total === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              disabled={datos.pagina >= datos.paginas}
              onClick={() => setPagina(datos.pagina + 1)}
              aria-label="Tratos siguientes"
            >
              Siguiente <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
