// ==========================================================================
// REPORTES: indicadores, 4 gráficas, tablas, PDF (impresión) y Excel
// El alcance lo decide la API: el admin ve la plataforma, el proveedor sus ventas y el
// emprendedor sus compras. Si cambia el modo claro/oscuro, las gráficas se redibujan.
// ==========================================================================
"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChartConfiguration } from "chart.js";
import { useEventoTiempoReal, useUsuario } from "@/componentes/sitio/ProveedorSitio";
import { api } from "@/lib/cliente/api";
import { agregarHoja, descargarLibro, fechaExcel, FORMATO, hoyTexto, libroNuevo } from "@/lib/cliente/excel";
import { colorVar, dibujar, ejeCategoria, ejeValor, tooltipBase, type TipoChart } from "@/lib/cliente/graficas";

type Mes = { mes: string; tratos: number; completados: number; cancelados: number; monto: number; montoCompletado: number };
type Datos = {
  alcance: "plataforma" | "ventas" | "compras";
  periodoMeses: number;
  generado: string;
  resumen: {
    monto: number;
    montoCompletado: number;
    tratos: number;
    completados: number;
    enCurso: number;
    cancelados: number;
    ticketPromedio: number;
    tasaExito: number | null;
    subastas: number;
  };
  ventasPorMes: Mes[];
  estadoSubastas: { estado: string; total: number }[];
  materialesMasPedidos: { categoria: string; pujas: number; subastas: number; pujaMaxima: number }[];
  preciosPorCategoria: { meses: string[]; series: { categoria: string; valores: (number | null)[] }[] };
  lotesMasDisputados: {
    lote: string;
    categoria: string;
    pujas: number;
    precioBase: number;
    precioFinal: number;
    incremento: number;
    estado: string;
  }[];
  tratos: { fecha: string; lote: string; proveedor: string; comprador: string; monto: number; estado: string }[];
};

const TEXTOS = {
  plataforma: {
    titulo: "Reporte de la plataforma",
    ventas: "Tratos por mes",
    detalle: "Detalle de tratos",
    nota: "Incluye los tratos y subastas de todos los usuarios.",
  },
  ventas: {
    titulo: "Mis ventas",
    ventas: "Mis ventas por mes",
    detalle: "Mis ventas",
    nota: "Tus subastas y los tratos que cerraste como proveedor. Los precios por categoría son de todo el mercado.",
  },
  compras: {
    titulo: "Mis compras",
    ventas: "Mis compras por mes",
    detalle: "Mis compras",
    nota: "Las subastas en las que pujaste y las que ganaste. Los precios por categoría son de todo el mercado.",
  },
};

// ------------------------------------------------------------------ FORMATOS
const fmtEntero = new Intl.NumberFormat("es-NI", { maximumFractionDigits: 0 });
const fmtDecimal = new Intl.NumberFormat("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = (n: number) => fmtEntero.format(Number(n) || 0);
const dinero = (n: number) => "C$ " + fmtDecimal.format(Number(n) || 0);
const dineroCorto = (n: number) => "C$ " + fmtEntero.format(Math.round(Number(n) || 0));
const porcentaje = (f: number) => ((Number(f) || 0) * 100).toLocaleString("es-NI", { maximumFractionDigits: 1 }) + "%";
function nombreMes(clave: string, largo = false) {
  const [a, m] = clave.split("-").map(Number);
  const txt = new Date(a, m - 1, 1).toLocaleDateString(
    "es-NI",
    largo ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" }
  );
  return txt.charAt(0).toUpperCase() + txt.slice(1).replace(".", "");
}
const fecha = (f: string) => new Date(f).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" });

function Vacio({ icono, texto }: { icono: string; texto: string }) {
  return (
    <div className="vacio">
      <i className={`ti ti-${icono}`} aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}
const Chip = ({ texto }: { texto: string }) => (
  <span className={`estado-chip ${String(texto).replace(/\s+/g, "-")}`}>{texto === "EnProceso" ? "En proceso" : texto}</span>
);
function Tabla({ columnas, filas }: { columnas: { titulo: string; num?: boolean }[]; filas: ReactNode[][] }) {
  if (!filas.length) return <Vacio icono="table-off" texto="Sin datos para este periodo." />;
  return (
    <table className="tabla">
      <thead>
        <tr>
          {columnas.map((c) => (
            <th key={c.titulo} className={c.num ? "num" : ""}>
              {c.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={i}>
            {columnas.map((c, j) => (
              <td key={j} className={c.num ? "num" : ""}>
                {f[j]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const Leyenda = ({ series, oculta }: { series: { nombre: string; color: string }[]; oculta?: boolean }) => (
  <div className="leyenda" hidden={oculta}>
    {series.map((s) => (
      <span key={s.nombre}>
        <i style={{ background: s.color }} />
        {s.nombre}
      </span>
    ))}
  </div>
);
function BotonVista({ tabla, alternar }: { tabla: boolean; alternar: () => void }) {
  return (
    <button className="btn-vista" type="button" aria-pressed={tabla} onClick={alternar}>
      <i className={`ti ${tabla ? "ti-chart-bar" : "ti-table"}`} aria-hidden="true" /> {tabla ? "Ver gráfica" : "Ver tabla"}
    </button>
  );
}

const COLORES_ESTADO: Record<string, string> = {
  "Con ganador": "#0ca30c",
  "Sin pujas": "#c98500",
  Canceladas: "#9c8b80",
  "En curso": "#2f6fd6",
};
const PALETA = ["#993D24", "#008f6b", "#c98500", "#2f6fd6", "#8a3ffc"];

export default function Reportes() {
  const usuario = useUsuario();
  const [meses, setMeses] = useState("6");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recargando, setRecargando] = useState(false);
  const [excel, setExcel] = useState(false);
  const [tablas, setTablas] = useState({ ventas: false, materiales: false, precios: false });
  const [toast, setToast] = useState<{ texto: string; error: boolean; visible: boolean }>({ texto: "", error: false, visible: false });
  const [tema, setTema] = useState(0); // cambia al pasar a claro/oscuro: se redibuja
  const dash = useRef<HTMLDivElement>(null);
  const lienzos = {
    ventas: useRef<HTMLCanvasElement>(null),
    estado: useRef<HTMLCanvasElement>(null),
    materiales: useRef<HTMLCanvasElement>(null),
    precios: useRef<HTMLCanvasElement>(null),
  };
  const graficas = useRef<Record<string, TipoChart>>({});
  const relojToast = useRef<ReturnType<typeof setTimeout>>(undefined);

  const mostrarToast = useCallback((texto: string, esError = false) => {
    setToast({ texto, error: esError, visible: true });
    clearTimeout(relojToast.current);
    relojToast.current = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 4500);
  }, []);

  const cargar = useCallback(async (periodo: string) => {
    setRecargando(true);
    try {
      const res = await api(`/api/reportes?meses=${encodeURIComponent(periodo)}`);
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message || "Error del servidor");
      setDatos(await res.json());
      setError(null);
    } catch (err) {
      console.error("Error al cargar el reporte:", err);
      setError("No se pudo cargar el reporte. " + ((err as Error).message || ""));
    } finally {
      setRecargando(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => cargar(meses), 0);
    return () => clearTimeout(t);
  }, [cargar, meses]);

  // Si cierra un trato o una subasta mientras la página está abierta, el reporte se actualiza
  const recarga = useRef<ReturnType<typeof setTimeout>>(undefined);
  const programarRecarga = () => {
    clearTimeout(recarga.current);
    recarga.current = setTimeout(() => cargar(meses), 1500);
  };
  useEventoTiempoReal("subastas:cambio", programarRecarga);
  useEventoTiempoReal("notificacion:nueva", programarRecarga);

  // Claro/oscuro: las gráficas toman sus colores al dibujarse
  useEffect(() => {
    const obs = new MutationObserver(() => setTema((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    return () => obs.disconnect();
  }, []);

  // ------------------------------------------------------------------ GRÁFICAS
  useEffect(() => {
    if (!datos) return;
    let cancelado = false;
    const d = datos;
    const el = dash.current;
    const grid = colorVar(el, "--grid");
    const texto = colorVar(el, "--texto-2");
    const nuevas: Record<string, TipoChart> = {};

    async function poner(clave: string, lienzo: HTMLCanvasElement | null, config: ChartConfiguration) {
      if (!lienzo || cancelado) return;
      const g = await dibujar(lienzo, config, texto);
      if (cancelado) g.destroy();
      else nuevas[clave] = g;
    }

    const serie = d.ventasPorMes;
    const cMonto = colorVar(el, "--serie-1");
    const cTratos = colorVar(el, "--serie-2");
    const totalEstado = d.estadoSubastas.reduce((t, e) => t + e.total, 0);
    const lista = d.materialesMasPedidos;
    const precios = d.preciosPorCategoria;

    Promise.all([
      !serie.every((m) => m.tratos === 0) &&
        poner("ventas", lienzos.ventas.current, {
          type: "bar",
          data: {
            labels: serie.map((m) => nombreMes(m.mes)),
            datasets: [
              {
                type: "bar",
                label: "Monto",
                data: serie.map((m) => m.monto),
                backgroundColor: cMonto,
                borderRadius: 4,
                maxBarThickness: 46,
                yAxisID: "y",
                order: 2,
              },
              {
                type: "line",
                label: "Tratos",
                data: serie.map((m) => m.tratos - m.cancelados),
                borderColor: cTratos,
                backgroundColor: cTratos,
                borderWidth: 2,
                pointRadius: 4,
                pointBorderColor: "#fff",
                pointBorderWidth: 2,
                yAxisID: "y2",
                order: 1,
                cubicInterpolationMode: "monotone",
              },
            ],
          } as ChartConfiguration["data"],
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                ...tooltipBase(),
                callbacks: {
                  title: (it) => nombreMes(serie[it[0].dataIndex].mes, true),
                  label: (it) =>
                    (it.dataset as { yAxisID?: string }).yAxisID === "y"
                      ? ` Monto: ${dinero(it.raw as number)}`
                      : ` Tratos: ${entero(it.raw as number)}`,
                },
              },
            },
            scales: {
              x: ejeCategoria(grid),
              y: ejeValor(grid, { callback: (v: number) => dineroCorto(v) }),
              y2: {
                position: "right",
                beginAtZero: true,
                grid: { display: false },
                border: { display: false },
                ticks: { precision: 0, padding: 6 },
              },
            },
          } as ChartConfiguration["options"],
        }),
      totalEstado > 0 &&
        poner("estado", lienzos.estado.current, {
          type: "doughnut",
          data: {
            labels: d.estadoSubastas.map((e) => e.estado),
            datasets: [
              {
                data: d.estadoSubastas.map((e) => e.total),
                backgroundColor: d.estadoSubastas.map((e) => COLORES_ESTADO[e.estado]),
                borderColor: "#fff",
                borderWidth: 2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "62%",
            plugins: {
              legend: {
                position: "bottom",
                labels: {
                  usePointStyle: true,
                  padding: 14,
                  generateLabels: (c) =>
                    (c.data.labels as string[]).map((l, i) => ({
                      text: `${l}: ${entero(c.data.datasets[0].data[i] as number)}`,
                      fillStyle: (c.data.datasets[0].backgroundColor as string[])[i],
                      strokeStyle: "#fff",
                      pointStyle: "circle",
                      index: i,
                    })),
                },
              },
              tooltip: {
                ...tooltipBase(),
                callbacks: {
                  label: (it) => ` ${it.label}: ${entero(it.raw as number)} (${porcentaje((it.raw as number) / totalEstado)})`,
                },
              },
            },
          } as ChartConfiguration<"doughnut">["options"],
        } as ChartConfiguration),
      lista.length > 0 &&
        poner("materiales", lienzos.materiales.current, {
          type: "bar",
          data: {
            labels: lista.map((m) => (m.categoria.length > 30 ? m.categoria.slice(0, 29) + "…" : m.categoria)),
            datasets: [
              {
                label: "Pujas",
                data: lista.map((m) => m.pujas),
                backgroundColor: colorVar(el, "--serie-3"),
                borderRadius: 4,
                maxBarThickness: 24,
              },
            ],
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                ...tooltipBase(),
                callbacks: {
                  title: (it) => lista[it[0].dataIndex].categoria,
                  label: (it) => ` ${entero(it.raw as number)} pujas en ${entero(lista[it.dataIndex].subastas)} subasta(s)`,
                },
              },
            },
            scales: { x: ejeValor(grid, { precision: 0 }), y: ejeCategoria(grid) },
          } as ChartConfiguration["options"],
        }),
      precios.series.length > 0 &&
        poner("precios", lienzos.precios.current, {
          type: "line",
          data: {
            labels: precios.meses.map((m) => nombreMes(m)),
            datasets: precios.series.map((s, i) => ({
              label: s.categoria,
              data: s.valores,
              borderColor: PALETA[i % PALETA.length],
              backgroundColor: PALETA[i % PALETA.length],
              borderWidth: 2,
              pointRadius: 4,
              pointBorderColor: "#fff",
              pointBorderWidth: 2,
              spanGaps: true,
              cubicInterpolationMode: "monotone",
            })),
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                ...tooltipBase(),
                callbacks: {
                  title: (it) => nombreMes(precios.meses[it[0].dataIndex], true),
                  label: (it) => ` ${it.dataset.label}: ${it.raw === null ? "sin lotes" : dinero(it.raw as number)}`,
                },
              },
            },
            scales: { x: ejeCategoria(grid), y: ejeValor(grid, { callback: (v: number) => dineroCorto(v) }) },
          } as ChartConfiguration["options"],
        } as ChartConfiguration),
    ]).then(() => {
      if (!cancelado) graficas.current = nuevas;
    });

    return () => {
      cancelado = true;
      Object.values(nuevas).forEach((g) => g.destroy());
      graficas.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- los lienzos son refs fijos
  }, [datos, tema]);

  // ------------------------------------------------------------------ IMPRIMIR / PDF
  // Chart.js no alcanza a redibujar al ancho de la hoja: cada gráfica se cambia por una
  // imagen de sí misma mientras dura la impresión.
  useEffect(() => {
    const terminar = () => {
      document.querySelectorAll("img.imagen-impresion").forEach((img) => img.remove());
      document.querySelectorAll("canvas.oculto-impresion").forEach((c) => c.classList.remove("oculto-impresion"));
    };
    const preparar = () => {
      terminar();
      Object.values(graficas.current).forEach((g) => {
        const img = document.createElement("img");
        img.className = "imagen-impresion";
        img.alt = g.canvas.getAttribute("aria-label") || "Gráfica";
        g.stop();
        g.resize();
        g.update("none");
        img.src = g.toBase64Image("image/png", 1);
        g.canvas.classList.add("oculto-impresion");
        g.canvas.after(img);
      });
    };
    window.addEventListener("beforeprint", preparar);
    window.addEventListener("afterprint", terminar);
    return () => {
      window.removeEventListener("beforeprint", preparar);
      window.removeEventListener("afterprint", terminar);
    };
  }, []);

  // El PDF sale de la impresión del navegador ("Guardar como PDF"), siempre en claro
  function exportarPdf() {
    mostrarToast('En la ventana de impresión elige "Guardar como PDF" como destino.');
    const raiz = document.documentElement;
    const oscuro = raiz.getAttribute("data-tema") === "oscuro";
    if (oscuro) {
      raiz.setAttribute("data-tema", "claro");
      window.addEventListener("afterprint", () => raiz.setAttribute("data-tema", "oscuro"), { once: true });
    }
    setTimeout(() => window.print(), oscuro ? 900 : 300);
  }

  const t = datos ? TEXTOS[datos.alcance] || TEXTOS.plataforma : TEXTOS.plataforma;
  const desde = datos ? nombreMes(datos.ventasPorMes[0].mes, true) : "";
  const hasta = datos ? nombreMes(datos.ventasPorMes[datos.ventasPorMes.length - 1].mes, true) : "";
  const periodoTexto = datos ? `De ${desde} a ${hasta} · últimos ${datos.periodoMeses} meses` : "cargando datos…";

  useEffect(() => {
    if (datos) document.title = `EntreLazados - ${t.titulo}`;
  }, [datos, t.titulo]);

  async function exportarExcel() {
    const d = datos;
    if (!d) return;
    setExcel(true);
    try {
      const libro = await libroNuevo();
      const r = d.resumen;
      const sub = `EntreLazados · ${periodoTexto} · Generado el ${new Date(d.generado).toLocaleString("es-NI")}`;
      const hojaResumen = agregarHoja(
        libro,
        "Resumen",
        t.titulo,
        sub,
        [
          { clave: "i", titulo: "Indicador", ancho: 38 },
          { clave: "v", titulo: "Valor", ancho: 18, formato: null },
        ],
        [
          ["Monto total (sin cancelados)", r.monto],
          ["Monto completado", r.montoCompletado],
          ["Tratos", r.tratos],
          ["Completados", r.completados],
          ["En curso", r.enCurso],
          ["Cancelados", r.cancelados],
          ["Ticket promedio", r.ticketPromedio],
          ["Subastas en el periodo", r.subastas],
          ["Subastas terminadas con ganador", r.tasaExito === null ? "—" : r.tasaExito],
        ]
      );
      [5, 6, 11].forEach((f) => (hojaResumen.getCell(f, 2).numFmt = FORMATO.dinero));
      [7, 8, 9, 10, 12].forEach((f) => (hojaResumen.getCell(f, 2).numFmt = FORMATO.entero));
      if (r.tasaExito !== null) hojaResumen.getCell(13, 2).numFmt = FORMATO.porcentaje;

      const vm = d.ventasPorMes;
      const claves = ["tratos", "completados", "cancelados", "monto", "montoCompletado"] as const;
      agregarHoja(
        libro,
        "Por mes",
        t.ventas,
        sub,
        [
          { clave: "m", titulo: "Mes", ancho: 20 },
          { clave: "t", titulo: "Tratos", formato: "entero" },
          { clave: "c", titulo: "Completados", formato: "entero" },
          { clave: "x", titulo: "Cancelados", formato: "entero" },
          { clave: "mo", titulo: "Monto", formato: "dinero" },
          { clave: "mc", titulo: "Monto completado", formato: "dinero", ancho: 18 },
        ],
        vm.map((m) => [nombreMes(m.mes, true), m.tratos, m.completados, m.cancelados, m.monto, m.montoCompletado]),
        ["Total", ...claves.map((k) => vm.reduce((s, m) => s + m[k], 0))]
      );
      agregarHoja(
        libro,
        "Materiales",
        "Materiales más pedidos",
        sub,
        [
          { clave: "c", titulo: "Categoría", ancho: 40 },
          { clave: "p", titulo: "Pujas", formato: "entero" },
          { clave: "s", titulo: "Subastas", formato: "entero" },
          { clave: "m", titulo: "Puja más alta", formato: "dinero" },
        ],
        d.materialesMasPedidos.map((m) => [m.categoria, m.pujas, m.subastas, m.pujaMaxima])
      );
      agregarHoja(
        libro,
        "Lotes",
        "Lotes más disputados",
        sub,
        [
          { clave: "l", titulo: "Lote", ancho: 36 },
          { clave: "c", titulo: "Categoría", ancho: 30 },
          { clave: "p", titulo: "Pujas", formato: "entero", ancho: 10 },
          { clave: "b", titulo: "Precio base", formato: "dinero" },
          { clave: "f", titulo: "Precio final", formato: "dinero" },
          { clave: "i", titulo: "Subió", formato: "porcentaje", ancho: 10 },
          { clave: "e", titulo: "Estado", ancho: 14 },
        ],
        d.lotesMasDisputados.map((l) => [l.lote, l.categoria, l.pujas, l.precioBase, l.precioFinal, l.incremento, l.estado])
      );
      const pc = d.preciosPorCategoria;
      agregarHoja(
        libro,
        "Precios",
        "Precio base promedio por categoría (todo el mercado)",
        sub,
        [
          { clave: "m", titulo: "Mes", ancho: 20 },
          ...pc.series.map((s, i) => ({ clave: "s" + i, titulo: s.categoria, formato: "dinero" as const, ancho: 22 })),
        ],
        pc.meses.map((mes, i) => [nombreMes(mes, true), ...pc.series.map((s) => s.valores[i])])
      );
      agregarHoja(
        libro,
        "Tratos",
        t.detalle,
        sub,
        [
          { clave: "f", titulo: "Fecha", formato: "fecha", ancho: 13 },
          { clave: "l", titulo: "Lote", ancho: 36 },
          { clave: "p", titulo: "Proveedor", ancho: 26 },
          { clave: "c", titulo: "Comprador", ancho: 26 },
          { clave: "m", titulo: "Monto", formato: "dinero" },
          { clave: "e", titulo: "Estado", ancho: 13 },
        ],
        d.tratos.map((x) => [
          fechaExcel(x.fecha),
          x.lote,
          x.proveedor,
          x.comprador,
          x.monto,
          x.estado === "EnProceso" ? "En proceso" : x.estado,
        ]),
        ["", "Total", "", "", d.tratos.filter((x) => x.estado !== "Cancelado").reduce((s, x) => s + x.monto, 0), "sin cancelados"]
      );
      const nombre = `EntreLazados_${t.titulo.replace(/\s+/g, "_")}_${hoyTexto()}.xlsx`;
      await descargarLibro(libro, nombre);
      mostrarToast(`Reporte descargado: ${nombre}`);
    } catch (err) {
      console.error("Error al exportar:", err);
      mostrarToast("No se pudo generar el archivo de Excel. Inténtalo de nuevo.", true);
    } finally {
      setExcel(false);
    }
  }

  const d = datos;
  const r = d?.resumen;
  const palabra = d?.alcance === "compras" ? "comprado" : d?.alcance === "ventas" ? "vendido" : "en tratos";
  const totalEstado = d ? d.estadoSubastas.reduce((s, e) => s + e.total, 0) : 0;
  const alternar = (clave: keyof typeof tablas) => setTablas((v) => ({ ...v, [clave]: !v[clave] }));
  const seriesPrecios = d ? d.preciosPorCategoria.series.map((s, i) => ({ ...s, nombre: s.categoria, color: PALETA[i % PALETA.length] })) : [];
  const columnasTratos = [{ titulo: "Fecha" }, { titulo: "Lote" }];
  if (d?.alcance !== "ventas") columnasTratos.push({ titulo: "Proveedor" });
  if (d?.alcance !== "compras") columnasTratos.push({ titulo: "Comprador" });

  return (
    <>
      <div className="dash" ref={dash}>
        <section className="dash-hero">
          <div className="dash-hero-inner">
            <div>
              <p className="eyebrow">Reportes</p>
              <h1 id="tituloReporte">{d ? t.titulo : "Reporte"}</h1>
              <p className="hero-sub">
                <span id="periodoTexto">{periodoTexto}</span>
              </p>
              <p className="nota-alcance" id="notaAlcance">
                {d ? t.nota : ""}
              </p>
            </div>
            <div className="toolbar" role="toolbar" aria-label="Opciones del reporte">
              <label htmlFor="filtroPeriodo">
                <i className="ti ti-calendar" aria-hidden="true" /> Periodo
                <select id="filtroPeriodo" value={meses} onChange={(e) => setMeses(e.target.value)}>
                  <option value="3">Últimos 3 meses</option>
                  <option value="6">Últimos 6 meses</option>
                  <option value="12">Últimos 12 meses</option>
                </select>
              </label>
              <button className="btn btn-excel" id="btnExcel" type="button" disabled={!d || excel} onClick={exportarExcel}>
                <i className={`ti ${excel ? "ti-loader-2" : "ti-file-spreadsheet"}`} aria-hidden="true" />{" "}
                {excel ? "Generando…" : "Excel"}
              </button>
              <button className="btn btn-pdf" id="btnPdf" type="button" disabled={!d} onClick={exportarPdf}>
                <i className="ti ti-file-type-pdf" aria-hidden="true" /> PDF
              </button>
            </div>
          </div>
        </section>

        <main className="main-content" id="contenido-principal" tabIndex={-1}>
          <div className="encabezado-impresion">
            <strong>
              EntreLazados · <span id="tituloImpresion">{t.titulo}</span>
            </strong>
            <span id="fechaImpresion">
              {d
                ? `${usuario?.nombre || ""} · De ${desde} a ${hasta} · Generado el ${new Date(d.generado).toLocaleString("es-NI")}`
                : ""}
            </span>
          </div>

          <div className="alerta" id="alertaError" role="alert" hidden={!error}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 20 }} aria-hidden="true" />
            <span id="alertaTexto">{error}</span>
            <button className="btn btn-ghost" type="button" onClick={() => cargar(meses)}>
              <i className="ti ti-refresh" aria-hidden="true" /> Reintentar
            </button>
          </div>

          <div className={`cargando-capa${recargando && d ? " recargando" : ""}`} id="contenido">
            <section className="kpi-grid cuatro" id="kpiGrid" aria-label="Indicadores principales">
              {r &&
                [
                  {
                    icono: "cash",
                    titulo: `Monto ${palabra}`,
                    valor: dineroCorto(r.monto),
                    pie: (
                      <>
                        <strong>{dineroCorto(r.montoCompletado)}</strong> ya completado
                      </>
                    ),
                  },
                  {
                    icono: "file-invoice",
                    titulo: "Tratos",
                    valor: entero(r.tratos),
                    pie: (
                      <>
                        <strong>{entero(r.completados)}</strong> completados · {entero(r.enCurso)} en curso · {entero(r.cancelados)}{" "}
                        cancelados
                      </>
                    ),
                  },
                  { icono: "receipt", titulo: "Ticket promedio", valor: dineroCorto(r.ticketPromedio), pie: "monto promedio por trato" },
                  {
                    icono: "target-arrow",
                    titulo: "Subastas con ganador",
                    valor: r.tasaExito === null ? "—" : porcentaje(r.tasaExito),
                    pie: `de las terminadas · ${entero(r.subastas)} subastas en el periodo`,
                  },
                ].map((k) => (
                  <div className="kpi" key={k.icono}>
                    <div className="kpi-cabecera">
                      <span>{k.titulo}</span>
                      <span className="kpi-icono">
                        <i className={`ti ti-${k.icono}`} aria-hidden="true" />
                      </span>
                    </div>
                    <div className="kpi-valor" title={k.valor}>
                      {k.valor}
                    </div>
                    <div className="kpi-pie">{k.pie}</div>
                  </div>
                ))}
            </section>

            <div className="fila fila-2-1">
              <article className="card">
                <div className="card-cabecera">
                  <div>
                    <h2>
                      <i className="ti ti-chart-bar" aria-hidden="true" /> <span id="tituloVentas">{t.ventas}</span>
                    </h2>
                    <p className="card-sub">Monto de los tratos (barras) y número de tratos (línea). No cuenta los cancelados.</p>
                  </div>
                  <BotonVista tabla={tablas.ventas} alternar={() => alternar("ventas")} />
                </div>
                <Leyenda
                  oculta={tablas.ventas}
                  series={[
                    { nombre: "Monto (C$)", color: "var(--serie-1)" },
                    { nombre: "Número de tratos", color: "var(--serie-2)" },
                  ]}
                />
                <div className="grafica grafica-alta" id="graficaVentasWrap" hidden={tablas.ventas}>
                  {d && d.ventasPorMes.every((m) => m.tratos === 0) ? (
                    <Vacio icono="chart-bar-off" texto="Todavía no hay tratos en este periodo." />
                  ) : (
                    <canvas ref={lienzos.ventas} id="graficaVentas" role="img" aria-label="Gráfica de ventas por mes" />
                  )}
                </div>
                <div className="tabla-wrap" id="tablaVentas" hidden={!tablas.ventas}>
                  {d && (
                    <Tabla
                      columnas={[
                        { titulo: "Mes" },
                        { titulo: "Tratos", num: true },
                        { titulo: "Completados", num: true },
                        { titulo: "Cancelados", num: true },
                        { titulo: "Monto", num: true },
                      ]}
                      filas={d.ventasPorMes.map((m) => [
                        nombreMes(m.mes, true),
                        entero(m.tratos),
                        entero(m.completados),
                        entero(m.cancelados),
                        dinero(m.monto),
                      ])}
                    />
                  )}
                </div>
              </article>

              <article className="card">
                <div className="card-cabecera">
                  <div>
                    <h2>
                      <i className="ti ti-chart-donut" aria-hidden="true" /> Resultado de las subastas
                    </h2>
                    <p className="card-sub" id="subEstado">
                      {d
                        ? `${entero(totalEstado)} subasta${totalEstado === 1 ? "" : "s"} abierta${totalEstado === 1 ? "" : "s"} en el periodo`
                        : "Subastas abiertas en el periodo"}
                    </p>
                  </div>
                </div>
                <div className="grafica grafica-alta" id="graficaEstadoWrap">
                  {d && totalEstado === 0 ? (
                    <Vacio icono="chart-donut" texto="No hubo subastas en este periodo." />
                  ) : (
                    <canvas ref={lienzos.estado} id="graficaEstado" role="img" aria-label="Gráfica del resultado de las subastas" />
                  )}
                </div>
              </article>
            </div>

            <div className="fila fila-1-1">
              <article className="card">
                <div className="card-cabecera">
                  <div>
                    <h2>
                      <i className="ti ti-flame" aria-hidden="true" /> Materiales más pedidos
                    </h2>
                    <p className="card-sub">Pujas por categoría en el periodo</p>
                  </div>
                  <BotonVista tabla={tablas.materiales} alternar={() => alternar("materiales")} />
                </div>
                <div
                  className="grafica"
                  id="graficaMaterialesWrap"
                  hidden={tablas.materiales}
                  style={d?.materialesMasPedidos.length ? { height: Math.max(200, d.materialesMasPedidos.length * 36 + 40) } : undefined}
                >
                  {d && !d.materialesMasPedidos.length ? (
                    <Vacio icono="flame-off" texto="Todavía no hay pujas en este periodo." />
                  ) : (
                    <canvas ref={lienzos.materiales} id="graficaMateriales" role="img" aria-label="Gráfica de materiales más pedidos" />
                  )}
                </div>
                <div className="tabla-wrap" id="tablaMateriales" hidden={!tablas.materiales}>
                  {d && (
                    <Tabla
                      columnas={[
                        { titulo: "Categoría" },
                        { titulo: "Pujas", num: true },
                        { titulo: "Subastas", num: true },
                        { titulo: "Puja más alta", num: true },
                      ]}
                      filas={d.materialesMasPedidos.map((m) => [m.categoria, entero(m.pujas), entero(m.subastas), dinero(m.pujaMaxima)])}
                    />
                  )}
                </div>
              </article>

              <article className="card">
                <div className="card-cabecera">
                  <div>
                    <h2>
                      <i className="ti ti-chart-line" aria-hidden="true" /> Precio promedio por categoría
                    </h2>
                    <p className="card-sub">
                      Precio base promedio de los lotes que salieron a subasta cada mes (todo el mercado)
                    </p>
                  </div>
                  <BotonVista tabla={tablas.precios} alternar={() => alternar("precios")} />
                </div>
                <Leyenda oculta={tablas.precios} series={seriesPrecios} />
                <div className="grafica grafica-alta" id="graficaPreciosWrap" hidden={tablas.precios}>
                  {d && !seriesPrecios.length ? (
                    <Vacio icono="chart-line" texto="No salieron lotes a subasta en este periodo." />
                  ) : (
                    <canvas ref={lienzos.precios} id="graficaPrecios" role="img" aria-label="Gráfica de precios por categoría" />
                  )}
                </div>
                <div className="tabla-wrap" id="tablaPrecios" hidden={!tablas.precios}>
                  {d && (
                    <Tabla
                      columnas={[{ titulo: "Mes" }, ...seriesPrecios.map((s) => ({ titulo: s.nombre, num: true }))]}
                      filas={d.preciosPorCategoria.meses.map((mes, i) => [
                        nombreMes(mes, true),
                        ...seriesPrecios.map((s) => (s.valores[i] === null ? "—" : dinero(s.valores[i] as number))),
                      ])}
                    />
                  )}
                </div>
              </article>
            </div>

            <article className="card" style={{ marginBottom: 20 }}>
              <div className="card-cabecera">
                <div>
                  <h2>
                    <i className="ti ti-trophy" aria-hidden="true" /> Lotes más disputados
                  </h2>
                  <p className="card-sub">Las subastas con más pujas y cuánto subió su precio</p>
                </div>
              </div>
              <div className="tabla-wrap" id="tablaLotes">
                {d && (
                  <Tabla
                    columnas={[
                      { titulo: "Lote" },
                      { titulo: "Categoría" },
                      { titulo: "Pujas", num: true },
                      { titulo: "Precio base", num: true },
                      { titulo: "Precio final", num: true },
                      { titulo: "Subió", num: true },
                      { titulo: "Estado" },
                    ]}
                    filas={d.lotesMasDisputados.map((l) => [
                      <span className="lote" key="l">
                        {l.lote}
                      </span>,
                      <span className="secundario" key="c">
                        {l.categoria}
                      </span>,
                      entero(l.pujas),
                      dinero(l.precioBase),
                      <strong key="f">{dinero(l.precioFinal)}</strong>,
                      porcentaje(l.incremento),
                      <Chip key="e" texto={l.estado} />,
                    ])}
                  />
                )}
              </div>
            </article>

            <article className="card">
              <div className="card-cabecera">
                <div>
                  <h2>
                    <i className="ti ti-file-invoice" aria-hidden="true" /> <span id="tituloDetalle">{t.detalle}</span>
                  </h2>
                  <p className="card-sub" id="subDetalle">
                    {!d
                      ? "Todos los tratos del periodo"
                      : d.tratos.length >= 200
                        ? "Los 200 tratos más recientes del periodo (el Excel trae los mismos)"
                        : `${entero(d.tratos.length)} trato${d.tratos.length === 1 ? "" : "s"} en el periodo`}
                  </p>
                </div>
              </div>
              <div className="tabla-wrap" id="tablaTratos">
                {d && (
                  <Tabla
                    columnas={[...columnasTratos, { titulo: "Monto", num: true }, { titulo: "Estado" }]}
                    filas={d.tratos.map((x) => [
                      fecha(x.fecha),
                      <span className="lote" key="l">
                        {x.lote}
                      </span>,
                      ...(d.alcance !== "ventas" ? [x.proveedor] : []),
                      ...(d.alcance !== "compras" ? [x.comprador] : []),
                      dinero(x.monto),
                      <Chip key="e" texto={x.estado} />,
                    ])}
                  />
                )}
              </div>
            </article>
          </div>
        </main>
      </div>

      <div className={`toast${toast.visible ? " visible" : ""}${toast.error ? " error" : ""}`} id="toast" role="status" aria-live="polite">
        {toast.texto}
      </div>
    </>
  );
}
