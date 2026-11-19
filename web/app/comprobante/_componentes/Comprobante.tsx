"use client";
// Comprobante de un trato: /comprobante?trato=ID. Muestra el resumen (folio, partes,
// monto en número y en letras) para imprimirlo o guardarlo como PDF.
// Los datos salen de GET /api/tratos/:id/comprobante (solo las dos partes y el admin);
// sin sesión (401) se va al login.
import { Fragment, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { leerJSON } from "@/lib/cliente/sesion";
import { enLetras } from "@/lib/cliente/numeros";

type Parte = {
  nombre: string;
  rol?: string;
  nombreComercial?: string;
  ruc?: string;
  correo?: string;
  telefono?: string;
  departamento?: string;
  direccion?: string;
};
type DatosComprobante = {
  folio: string;
  estado: string;
  fechaCierre: string;
  emitido: string;
  tratoId: number;
  concepto: string;
  origen: string;
  monto: number;
  proveedor: Parte;
  comprador: Parte;
  subasta?: { id: number; categoria?: string; pujas: number; cierre: string; precioBase: number } | null;
};
type Estado = { tipo: "cargando" } | { tipo: "mensaje"; icono: string; texto: string } | { tipo: "listo"; c: DatosComprobante };

const dinero = (n: number) => "C$ " + Number(n).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (f: string | null | undefined, conHora = false) =>
  f
    ? new Date(f).toLocaleString(
        "es-NI",
        conHora ? { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "long", year: "numeric" }
      )
    : "—";
const ESTADOS: Record<string, string> = { Pendiente: "Pendiente", EnProceso: "En proceso", Completado: "Completado", Cancelado: "Anulado" };
const ICONOS: Record<string, string> = { Pendiente: "ti-hourglass", EnProceso: "ti-truck-delivery", Completado: "ti-circle-check", Cancelado: "ti-circle-x" };
const AVISOS: Record<string, string> = {
  Pendiente: "Trato pendiente: el pago y la entrega todavía no se han confirmado.",
  EnProceso: "Trato en proceso: las partes ya acordaron el pago y la entrega, pero aún no se marca como completado.",
  Cancelado: "Este trato fue cancelado: el comprobante queda anulado.",
};

function TarjetaParte({ titulo, p }: { titulo: string; p: Parte }) {
  const datos: [string, string | undefined][] = [
    [p.rol === "Proveedor" ? "Comercio" : "Marca", p.nombreComercial],
    ["RUC", p.ruc],
    ["Correo", p.correo],
    ["Teléfono", p.telefono],
    ["Departamento", p.departamento],
    ["Dirección", p.direccion],
  ];
  return (
    <section className="parte" aria-label={titulo}>
      <h2>{titulo}</h2>
      <div className="nombre">{p.nombre}</div>
      <dl>
        {datos
          .filter(([, valor]) => valor)
          .map(([etiqueta, valor]) => (
            <Fragment key={etiqueta}>
              <dt>{etiqueta}</dt>
              <dd>{valor}</dd>
            </Fragment>
          ))}
      </dl>
    </section>
  );
}

function Hoja({ c }: { c: DatosComprobante }) {
  const s = c.subasta;
  return (
    <article className="hoja" aria-label={`Comprobante ${c.folio}`}>
      {c.estado === "Cancelado" && (
        <div className="sello" aria-hidden="true">
          ANULADO
        </div>
      )}
      <header className="cabecera">
        <div className="marca">
          {/* eslint-disable-next-line @next/next/no-img-element -- la hoja se imprime: imagen simple de public/ */}
          <img src="/logo.png" alt="" />
          <div>
            <strong>
              Entre<span>Lazados</span>
            </strong>
            <small>Mercado de materia prima para calzado y marroquinería · Nicaragua</small>
          </div>
        </div>
        <div className="folio">
          <h1>Comprobante de trato</h1>
          <div className="numero">{c.folio}</div>
          <div className="fecha">Cierre del trato: {fecha(c.fechaCierre, true)}</div>
          <span className={`estado ${c.estado}`}>
            <i className={`ti ${ICONOS[c.estado] || "ti-info-circle"}`} aria-hidden="true" /> {ESTADOS[c.estado] || c.estado}
          </span>
        </div>
      </header>

      <div className="partes">
        <TarjetaParte titulo="Vende (proveedor)" p={c.proveedor} />
        <TarjetaParte titulo="Compra (emprendedor)" p={c.comprador} />
      </div>

      <table>
        <thead>
          <tr>
            <th scope="col">Concepto</th>
            <th scope="col" className="num">
              Precio base
            </th>
            <th scope="col" className="num">
              Monto acordado
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>{c.concepto}</strong>
              <small>
                {s
                  ? `Subasta #${Number(s.id)}${s.categoria ? " · " + s.categoria : ""} · ${Number(s.pujas)} puja${s.pujas === 1 ? "" : "s"} · cerró el ${fecha(s.cierre, true)}`
                  : `Origen: ${c.origen}`}
              </small>
            </td>
            <td className="num">{s ? dinero(s.precioBase) : "—"}</td>
            <td className="num">{dinero(c.monto)}</td>
          </tr>
        </tbody>
      </table>

      <div className="total">
        <div>
          <div className="fila">
            <span>Subtotal</span>
            <span>{dinero(c.monto)}</span>
          </div>
          <div className="fila grande">
            <span>Total</span>
            <span>{dinero(c.monto)}</span>
          </div>
        </div>
      </div>
      <p className="letras">Son: {enLetras(c.monto)}</p>

      {AVISOS[c.estado] && <p className="aviso-estado">{AVISOS[c.estado]}</p>}

      <p className="nota">
        Este comprobante resume un acuerdo entre las partes registrado en EntreLazados. <strong>No es una factura fiscal</strong>: si necesitas una
        factura válida ante la DGI, solicítala directamente al proveedor. Emitido el {fecha(c.emitido, true)} · Trato #{Number(c.tratoId)}.
      </p>
    </article>
  );
}

export default function Comprobante() {
  const router = useRouter();
  const id = parseInt(useSearchParams().get("trato") ?? "", 10);
  const idValido = id > 0;
  const [estado, setEstado] = useState<Estado>(
    idValido ? { tipo: "cargando" } : { tipo: "mensaje", icono: "ti-file-off", texto: "Falta el número del trato en la dirección." }
  );

  useEffect(() => {
    if (!idValido) return;
    let vigente = true;
    (async () => {
      try {
        const res = await fetch(`/api/tratos/${id}/comprobante`);
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const c = await leerJSON<DatosComprobante & { message?: string }>(res);
        if (!vigente) return;
        if (!res.ok) return setEstado({ tipo: "mensaje", icono: "ti-file-off", texto: c.message || "No se pudo cargar el comprobante." });
        document.title = `Comprobante ${c.folio} - EntreLazados`;
        setEstado({ tipo: "listo", c });
      } catch {
        if (vigente) setEstado({ tipo: "mensaje", icono: "ti-wifi-off", texto: "No se pudo conectar con el servidor." });
      }
    })();
    return () => {
      vigente = false;
    };
  }, [id, idValido, router]);

  return (
    <>
      <div className="barra">
        <a href="/dashboard.html">
          <i className="ti ti-arrow-left" aria-hidden="true" /> Volver al dashboard
        </a>
        <button type="button" className="principal" id="btnImprimir" onClick={() => window.print()} disabled={estado.tipo !== "listo"}>
          <i className="ti ti-file-type-pdf" aria-hidden="true" /> Guardar como PDF o imprimir
        </button>
      </div>
      <main id="contenido-principal" tabIndex={-1} aria-live="polite">
        {estado.tipo === "listo" ? (
          <Hoja c={estado.c} />
        ) : estado.tipo === "mensaje" ? (
          <div className="mensaje">
            <i className={`ti ${estado.icono}`} aria-hidden="true" />
            <p>{estado.texto}</p>
          </div>
        ) : (
          <div className="mensaje">
            <p>Cargando comprobante…</p>
          </div>
        )}
      </main>
    </>
  );
}

export function CargandoComprobante() {
  return (
    <main id="contenido-principal" aria-live="polite">
      <div className="mensaje">
        <p>Cargando comprobante…</p>
      </div>
    </main>
  );
}
