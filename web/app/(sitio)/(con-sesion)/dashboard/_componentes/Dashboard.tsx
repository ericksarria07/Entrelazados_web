// ==========================================================================
// DASHBOARD: indicadores, mi actividad, gráficas, precios, subastas en curso,
// pujas recientes, publicar (proveedor) o accesos rápidos, y exportar a Excel.
// ==========================================================================
"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Chart as TipoChartJs, ChartConfiguration, Plugin } from "chart.js";
import { useUsuario } from "@/componentes/sitio/ProveedorSitio";
import { api } from "@/lib/cliente/api";
import { agregarHoja, descargarLibro, fechaExcel, FORMATO, hoyTexto, libroNuevo } from "@/lib/cliente/excel";
import { colorVar, dibujar, tooltipBase, type TipoChart } from "@/lib/cliente/graficas";
import { dinero, dineroCorto, entero, haceCuanto, nombreLote, nombreMes, porcentaje, tiempoRestante } from "./formatos";
import MisTratos from "./MisTratos";
import PublicarMaterial from "./PublicarMaterial";

type MiActividad = Record<string, number> & { rol: string };
type Datos = {
  generado: string;
  periodoMeses: number;
  esAdmin: boolean;
  resumen: Record<string, number>;
  miActividad: MiActividad;
  actividad: { mes: string; registros: number; ofertas: number; pujas: number }[];
  departamentos: { departamento: string; proveedores: number; emprendedores: number }[];
  categorias: { categoria: string; ofertas: number; precioPromedio: number; precioMinimo: number; precioMaximo: number }[];
  subastas: {
    id: number;
    lote: string;
    proveedor: string;
    precioBase: number;
    precioActual: number;
    pujas: number;
    fechaFin: string;
    esMia: boolean;
  }[];
  pujasRecientes: { lote: string; fecha: string; monto: number; esMia: boolean; postor?: string }[];
};

function Vacio({ icono, texto }: { icono: string; texto: string }) {
  return (
    <div className="vacio">
      <i className={`ti ti-${icono}`} aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}
function Tabla({ columnas, filas }: { columnas: { titulo: string; num?: boolean }[]; filas: ReactNode[][] }) {
  if (!filas.length) return <Vacio icono="table-off" texto="Sin datos para mostrar." />;
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

// "★ 4.5 (3)": promedio de las calificaciones que me dieron en tratos completados
const textoCalificacion = (m: MiActividad) =>
  m.misCalificaciones ? `★ ${Number(m.miCalificacion).toFixed(1)} (${entero(m.misCalificaciones)})` : "—";

function datosMiActividad(m: MiActividad | undefined) {
  if (!m) return null;
  if (m.rol === "proveedor")
    return {
      titulo: "Mi actividad como proveedor",
      filas: [
        ["Mis ofertas publicadas", entero(m.misOfertas), m.misOfertas],
        ["Mis subastas activas", entero(m.misSubastasActivas), m.misSubastasActivas],
        ["Pujas recibidas", entero(m.pujasRecibidas), m.pujasRecibidas],
        ["Valor actual de mis lotes", dineroCorto(m.valorMisSubastas), m.valorMisSubastas],
        ["Subastas vendidas", entero(m.subastasVendidas), m.subastasVendidas],
        ["Monto vendido en subastas", dineroCorto(m.montoVendido), m.montoVendido],
        ["Mensajes recibidos", entero(m.mensajesRecibidos), m.mensajesRecibidos],
        ["Mi calificación", textoCalificacion(m), m.miCalificacion || 0],
      ] as [string, string, number][],
    };
  if (m.rol === "emprendedor")
    return {
      titulo: "Mi actividad como emprendedor",
      filas: [
        ["Pujas realizadas", entero(m.misPujas), m.misPujas],
        ["Subastas en las que participo", entero(m.subastasParticipando), m.subastasParticipando],
        ["Subastas que voy ganando", entero(m.subastasLiderando), m.subastasLiderando],
        ["Monto de los lotes que lidero", dineroCorto(m.montoLiderando), m.montoLiderando],
        ["Subastas ganadas", entero(m.subastasGanadas), m.subastasGanadas],
        ["Monto de subastas ganadas", dineroCorto(m.montoGanado), m.montoGanado],
        ["Mensajes recibidos", entero(m.mensajesRecibidos), m.mensajesRecibidos],
        ["Mi calificación", textoCalificacion(m), m.miCalificacion || 0],
      ] as [string, string, number][],
    };
  return null;
}

// Etiqueta al final de cada línea (sin encimarse)
function etiquetasFinales(colorTexto: string): Plugin<"line"> {
  return {
    id: "etiquetasFinales",
    afterDatasetsDraw(chart: TipoChartJs<"line">) {
      const { ctx, chartArea } = chart;
      const items = chart.data.datasets
        .map((ds, i) => {
          const meta = chart.getDatasetMeta(i);
          const p = meta.data[meta.data.length - 1];
          return !meta.hidden && p ? { texto: String(ds.label), x: p.x, y: p.y } : null;
        })
        .filter((x): x is { texto: string; x: number; y: number } => !!x)
        .sort((a, b) => a.y - b.y);
      const SEP = 14;
      for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < SEP) items[i].y = items[i - 1].y + SEP;
      if (items.length && items[items.length - 1].y > chartArea.bottom) {
        items[items.length - 1].y = chartArea.bottom;
        for (let i = items.length - 2; i >= 0; i--) if (items[i + 1].y - items[i].y < SEP) items[i].y = items[i + 1].y - SEP;
      }
      ctx.save();
      ctx.font = `600 12px ${chart.options.font?.family ?? "sans-serif"}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = colorTexto;
      items.forEach((it) => ctx.fillText(it.texto, Math.min(it.x + 10, chartArea.right + 10), it.y));
      ctx.restore();
    },
  };
}

const LIMITE_SUBASTAS = 8;

export default function Dashboard() {
  const usuario = useUsuario();
  const rol = (usuario?.rol || "").toLowerCase().trim();
  const esAdmin = !!usuario?.esAdmin;
  const [meses, setMeses] = useState("6");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [excel, setExcel] = useState(false);
  const [tablas, setTablas] = useState({ actividad: false, departamentos: false, categorias: false });
  const [filtro, setFiltro] = useState("");
  const [verTodas, setVerTodas] = useState(false);
  const [tratos, setTratos] = useState(0); // recarga "Mis tratos"
  const [tema, setTema] = useState(0);
  const [toast, setToast] = useState({ texto: "", error: false, visible: false });
  const dash = useRef<HTMLDivElement>(null);
  const lienzoActividad = useRef<HTMLCanvasElement>(null);
  const lienzoDepartamentos = useRef<HTMLCanvasElement>(null);
  const lienzoCategorias = useRef<HTMLCanvasElement>(null);
  const relojToast = useRef<ReturnType<typeof setTimeout>>(undefined);

  const avisar = useCallback((texto: string, esError = false) => {
    setToast({ texto, error: esError, visible: true });
    clearTimeout(relojToast.current);
    relojToast.current = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3500);
  }, []);

  const cargar = useCallback(async (periodo: string) => {
    setCargando(true);
    try {
      const res = await api(`/api/dashboard?meses=${encodeURIComponent(periodo)}`);
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message || "Error del servidor");
      setDatos(await res.json());
      setError(false);
      setTratos((v) => v + 1);
    } catch (err) {
      console.error("Error al cargar el dashboard:", err);
      setError(true);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => cargar(meses), 0);
    return () => clearTimeout(t);
  }, [cargar, meses]);

  useEffect(() => {
    const obs = new MutationObserver(() => setTema((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    return () => obs.disconnect();
  }, []);

  // ------------------------------------------------------------------ GRÁFICAS
  useEffect(() => {
    if (!datos) return;
    let cancelado = false;
    const hechas: TipoChart[] = [];
    const el = dash.current;
    const grid = colorVar(el, "--grid");
    const texto = colorVar(el, "--texto-2");
    const ejes = (horizontal = false) => {
      const valor = {
        beginAtZero: true,
        grid: { color: grid, drawTicks: false },
        border: { display: false },
        ticks: { precision: 0, padding: 6 } as Record<string, unknown>,
        stacked: false,
      };
      const categoria = { grid: { display: false }, border: { color: grid }, ticks: { padding: 6 } as Record<string, unknown>, stacked: false };
      return horizontal ? { x: valor, y: categoria } : { x: categoria, y: valor };
    };
    const poner = async (lienzo: HTMLCanvasElement | null, config: ChartConfiguration) => {
      if (!lienzo || cancelado) return;
      const g = await dibujar(lienzo, config, texto);
      if (cancelado) g.destroy();
      else hechas.push(g);
    };

    const act = datos.actividad;
    const series = [
      { clave: "registros" as const, nombre: "Registros", color: colorVar(el, "--serie-1") },
      { clave: "ofertas" as const, nombre: "Ofertas", color: colorVar(el, "--serie-2") },
      { clave: "pujas" as const, nombre: "Pujas", color: colorVar(el, "--serie-3") },
    ];
    if (act.reduce((t, a) => t + a.registros + a.ofertas + a.pujas, 0) > 0) {
      poner(lienzoActividad.current, {
        type: "line",
        data: {
          labels: act.map((a) => nombreMes(a.mes)),
          datasets: series.map((s) => ({
            label: s.nombre,
            data: act.map((a) => a[s.clave]),
            borderColor: s.color,
            backgroundColor: s.color,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            cubicInterpolationMode: "monotone",
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 70, top: 8 } },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { ...tooltipBase(), callbacks: { title: (it) => nombreMes(act[it[0].dataIndex].mes, true) } },
          },
          scales: ejes(),
        },
        plugins: [etiquetasFinales(texto)],
      } as ChartConfiguration);
    }

    const deps = datos.departamentos;
    if (deps.length) {
      const s = ejes(true);
      s.x.stacked = true;
      s.y.stacked = true;
      poner(lienzoDepartamentos.current, {
        type: "bar",
        data: {
          labels: deps.map((d) => d.departamento),
          datasets: [
            {
              label: "Proveedores",
              data: deps.map((d) => d.proveedores),
              backgroundColor: colorVar(el, "--serie-1"),
              borderColor: "#fff",
              borderWidth: { right: 2 },
              borderSkipped: false,
              borderRadius: 0,
              maxBarThickness: 18,
            },
            {
              label: "Emprendedores",
              data: deps.map((d) => d.emprendedores),
              backgroundColor: colorVar(el, "--serie-2"),
              borderRadius: { topRight: 4, bottomRight: 4 },
              borderSkipped: false,
              maxBarThickness: 18,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", axis: "y", intersect: false },
          plugins: { legend: { display: false }, tooltip: tooltipBase() },
          scales: s,
        },
      } as ChartConfiguration);
    }

    const cats = datos.categorias;
    if (cats.length) {
      // En pantallas angostas los nombres largos se recortan más (completo en el tooltip y la tabla)
      const recortar = (t: string, ancho: number) => {
        const max = ancho < 520 ? 15 : 28;
        return t.length > max ? t.slice(0, max - 1) + "…" : t;
      };
      const s = ejes(true);
      s.y.ticks.callback = function (this: { getLabelForValue: (v: number) => string; chart: { width: number } }, v: number) {
        return recortar(this.getLabelForValue(v), this.chart.width);
      };
      poner(lienzoCategorias.current, {
        type: "bar",
        data: {
          labels: cats.map((c) => c.categoria),
          datasets: [
            {
              label: "Ofertas",
              data: cats.map((c) => c.ofertas),
              backgroundColor: colorVar(el, "--serie-1"),
              borderRadius: 4,
              borderSkipped: "start",
              maxBarThickness: 16,
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
                label: (it) => ` ${entero(it.raw as number)} ${it.raw === 1 ? "oferta" : "ofertas"}`,
                afterLabel: (it) => ` Precio promedio: ${dinero(cats[it.dataIndex].precioPromedio)}`,
              },
            },
          },
          scales: s,
        },
      } as ChartConfiguration);
    }

    return () => {
      cancelado = true;
      hechas.forEach((g) => g.destroy());
    };
  }, [datos, tema]);

  // ------------------------------------------------------------------ EXCEL
  async function exportarExcel() {
    const d = datos;
    if (!d) return;
    setExcel(true);
    try {
      const libro = await libroNuevo();
      const r = d.resumen;
      const generado = `EntreLazados · Generado el ${new Date(d.generado).toLocaleString("es-NI")}`;
      const opciones = { autoFiltro: true, bordes: true };
      const hojaResumen = agregarHoja(
        libro,
        "Resumen",
        "Reporte del Dashboard · EntreLazados",
        `Generado por ${usuario?.nombre || "Usuario"} el ${new Date(d.generado).toLocaleString("es-NI")} · periodo de actividad: últimos ${d.periodoMeses} meses`,
        [
          { clave: "a", titulo: "Indicador", ancho: 40 },
          { clave: "b", titulo: "Total", ancho: 18, formato: "entero" },
          { clave: "c", titulo: "Últimos 30 días", ancho: 18, formato: "entero" },
        ],
        [
          ["Proveedores registrados", r.proveedores, null],
          ["Emprendedores registrados", r.emprendedores, null],
          ["Usuarios nuevos", null, r.nuevosUsuarios30d],
          ["Ofertas publicadas", r.ofertas, r.ofertas30d],
          ["Precio promedio de las ofertas (C$)", r.precioPromedio, null],
          ["Subastas activas", r.subastasActivas, null],
          ["Subastas finalizadas", r.subastasCerradas, null],
          ["Valor total en subasta (C$)", r.valorEnSubasta, null],
          ["Pujas realizadas", r.pujas, r.pujas30d],
          ["Mensajes enviados", r.mensajes, r.mensajes30d],
        ],
        null,
        opciones
      );
      [5, 8].forEach((i) => (hojaResumen.getRow(4 + i).getCell(2).numFmt = FORMATO.dinero));
      const mia = datosMiActividad(d.miActividad);
      if (mia) {
        hojaResumen.addRow([]);
        hojaResumen.addRow([mia.titulo]).getCell(1).font = { bold: true, size: 12, color: { argb: "FF3D170A" } };
        mia.filas.forEach(([etq, , valor]) => {
          const fila = hojaResumen.addRow([etq, Number(valor) || 0]);
          fila.getCell(2).numFmt = /Valor|Monto/.test(etq) ? FORMATO.dinero : FORMATO.entero;
        });
      }
      const act = d.actividad;
      const clavesAct = ["registros", "ofertas", "pujas"] as const;
      agregarHoja(
        libro,
        "Actividad mensual",
        `Actividad mensual · últimos ${d.periodoMeses} meses`,
        generado,
        [
          { clave: "mes", titulo: "Mes", ancho: 22 },
          { clave: "r", titulo: "Registros", formato: "entero" },
          { clave: "o", titulo: "Ofertas", formato: "entero" },
          { clave: "p", titulo: "Pujas", formato: "entero" },
        ],
        act.map((a) => [nombreMes(a.mes, true), a.registros, a.ofertas, a.pujas]),
        ["Total", ...clavesAct.map((k) => act.reduce((t, a) => t + a[k], 0))],
        opciones
      );
      const cats = d.categorias;
      agregarHoja(
        libro,
        "Categorías",
        "Ofertas y precios por categoría",
        generado,
        [
          { clave: "c", titulo: "Categoría", ancho: 40 },
          { clave: "n", titulo: "Ofertas", formato: "entero", ancho: 12 },
          { clave: "min", titulo: "Precio mínimo", formato: "dinero" },
          { clave: "avg", titulo: "Precio promedio", formato: "dinero" },
          { clave: "max", titulo: "Precio máximo", formato: "dinero" },
        ],
        cats.map((c) => [c.categoria, c.ofertas, c.precioMinimo, c.precioPromedio, c.precioMaximo]),
        ["Total", cats.reduce((t, c) => t + c.ofertas, 0), null, r.precioPromedio, null],
        opciones
      );
      const deps = d.departamentos;
      agregarHoja(
        libro,
        "Departamentos",
        "Usuarios por departamento",
        generado,
        [
          { clave: "d", titulo: "Departamento", ancho: 28 },
          { clave: "p", titulo: "Proveedores", formato: "entero" },
          { clave: "e", titulo: "Emprendedores", formato: "entero" },
          { clave: "t", titulo: "Total", formato: "entero" },
        ],
        deps.map((x) => [x.departamento, x.proveedores, x.emprendedores, x.proveedores + x.emprendedores]),
        [
          "Total",
          deps.reduce((t, x) => t + x.proveedores, 0),
          deps.reduce((t, x) => t + x.emprendedores, 0),
          deps.reduce((t, x) => t + x.proveedores + x.emprendedores, 0),
        ],
        opciones
      );
      agregarHoja(
        libro,
        "Subastas en curso",
        "Subastas activas",
        generado,
        [
          { clave: "id", titulo: "N.º", ancho: 8, formato: "entero" },
          { clave: "l", titulo: "Lote", ancho: 40 },
          { clave: "pr", titulo: "Proveedor", ancho: 28 },
          { clave: "b", titulo: "Precio base", formato: "dinero" },
          { clave: "a", titulo: "Puja actual", formato: "dinero" },
          { clave: "i", titulo: "Incremento", formato: "porcentaje", ancho: 13 },
          { clave: "n", titulo: "Pujas", formato: "entero", ancho: 10 },
          { clave: "f", titulo: "Cierra el", formato: "fechaHora", ancho: 18 },
        ],
        d.subastas.map((s) => [
          s.id,
          nombreLote(s.lote),
          s.proveedor,
          s.precioBase,
          s.precioActual,
          s.precioBase > 0 ? (s.precioActual - s.precioBase) / s.precioBase : 0,
          s.pujas,
          fechaExcel(s.fechaFin),
        ]),
        [
          "",
          "Total",
          "",
          d.subastas.reduce((t, s) => t + s.precioBase, 0),
          d.subastas.reduce((t, s) => t + s.precioActual, 0),
          null,
          d.subastas.reduce((t, s) => t + s.pujas, 0),
          null,
        ],
        opciones
      );
      agregarHoja(
        libro,
        "Pujas recientes",
        "Últimas pujas registradas",
        generado,
        [
          { clave: "f", titulo: "Fecha", formato: "fechaHora", ancho: 18 },
          { clave: "l", titulo: "Lote", ancho: 40 },
          { clave: "m", titulo: "Monto", formato: "dinero" },
          ...(d.esAdmin ? [{ clave: "p", titulo: "Postor", ancho: 28 }] : []),
        ],
        d.pujasRecientes.map((p) => [fechaExcel(p.fecha), nombreLote(p.lote), p.monto, ...(d.esAdmin ? [p.postor] : [])]),
        null,
        opciones
      );
      const nombre = `EntreLazados_Dashboard_${hoyTexto()}.xlsx`;
      await descargarLibro(libro, nombre);
      avisar(`Reporte descargado: ${nombre}`);
    } catch (err) {
      console.error("Error al exportar:", err);
      avisar("No se pudo generar el archivo de Excel. Inténtalo de nuevo.", true);
    } finally {
      setExcel(false);
    }
  }

  // ------------------------------------------------------------------ PINTAR
  const d = datos;
  const r = d?.resumen;
  const mia = datosMiActividad(d?.miActividad);
  const alternar = (clave: keyof typeof tablas) => setTablas((v) => ({ ...v, [clave]: !v[clave] }));
  const nuevo = (n: number, texto: string) =>
    n > 0 ? (
      <>
        <span className="delta-sube">+{entero(n)}</span> {texto}
      </>
    ) : (
      `Sin cambios ${texto}`
    );
  const totalUsuarios = r ? r.proveedores + r.emprendedores : 0;
  const totalActividad = d ? d.actividad.reduce((t, a) => t + a.registros + a.ofertas + a.pujas, 0) : 0;
  const filtradas = d
    ? d.subastas.filter((s) => {
        const f = filtro.trim().toLowerCase();
        return !f || nombreLote(s.lote).toLowerCase().includes(f) || s.proveedor.toLowerCase().includes(f);
      })
    : [];
  const visibles = verTodas ? filtradas : filtradas.slice(0, LIMITE_SUBASTAS);
  const maxInc = Math.max(1, ...filtradas.map((s) => (s.precioBase > 0 ? ((s.precioActual - s.precioBase) / s.precioBase) * 100 : 0)));
  const accesos = [
    ...(esAdmin
      ? [{ href: "/admin", icono: "shield-check", titulo: "Panel de administración", texto: "Usuarios, moderación y categorías", clase: "acceso-admin" }]
      : []),
    { href: "/mercado", icono: "building-store", titulo: "Mercado y subastas", texto: "Explora materiales y puja por lotes", clase: "" },
    { href: "/chat", icono: "messages", titulo: "Mensajes", texto: "Conversa con proveedores y talleres", clase: "" },
    { href: "/perfil", icono: "id", titulo: "Mi perfil", texto: "Revisa y actualiza tus datos", clase: "" },
  ];

  return (
    <>
      <div className="dash" ref={dash}>
        <section className="dash-hero">
          <div className="dash-hero-inner">
            <div>
              <p className="eyebrow">Panel de control</p>
              <h1>
                Hola, <span id="saludoNombre">{usuario?.nombre || "bienvenido"}</span>
              </h1>
              <p className="hero-sub">
                Resumen de la actividad de EntreLazados ·{" "}
                <span id="ultimaActualizacion">
                  {d
                    ? `actualizado hoy a las ${new Date(d.generado).toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit" })}`
                    : error
                      ? "sin datos"
                      : "cargando datos…"}
                </span>
              </p>
            </div>
            <div className="toolbar" role="toolbar" aria-label="Opciones del dashboard">
              <label htmlFor="filtroPeriodo">
                <i className="ti ti-calendar" aria-hidden="true" /> Periodo
                <select id="filtroPeriodo" value={meses} onChange={(e) => setMeses(e.target.value)}>
                  <option value="3">Últimos 3 meses</option>
                  <option value="6">Últimos 6 meses</option>
                  <option value="12">Últimos 12 meses</option>
                </select>
              </label>
              <button className="btn btn-ghost" id="btnActualizar" type="button" disabled={cargando} onClick={() => cargar(meses)}>
                <i className="ti ti-refresh" aria-hidden="true" /> Actualizar
              </button>
              <button className="btn btn-excel" id="btnExportar" type="button" disabled={!d || excel} onClick={exportarExcel}>
                <i className={`ti ${excel ? "ti-loader-2" : "ti-file-spreadsheet"}`} aria-hidden="true" />{" "}
                {excel ? "Generando…" : "Exportar a Excel"}
              </button>
            </div>
          </div>
        </section>

        <main className="main-content" id="contenido-principal" tabIndex={-1}>
          <div className="alerta" id="alertaError" role="alert" hidden={!error}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 20 }} aria-hidden="true" />
            <span id="alertaTexto">
              {d
                ? "No se pudieron actualizar las estadísticas. Se muestran los últimos datos cargados."
                : "No se pudieron cargar las estadísticas. Revisa tu conexión e inténtalo de nuevo."}
            </span>
            <button className="btn btn-ghost" type="button" onClick={() => cargar(meses)}>
              <i className="ti ti-refresh" aria-hidden="true" /> Reintentar
            </button>
          </div>

          <div className={`cargando-capa${cargando && d ? " recargando" : ""}`} id="contenidoDashboard">
            {/* INDICADORES PRINCIPALES */}
            <section className="kpi-grid" id="kpiGrid" aria-label="Indicadores principales">
              {r &&
                (
                  [
                    ["building-factory", "Proveedores", entero(r.proveedores), `${porcentaje(totalUsuarios ? (r.proveedores / totalUsuarios) * 100 : 0)} de los usuarios`],
                    ["shoe", "Emprendedores", entero(r.emprendedores), nuevo(r.nuevosUsuarios30d, "usuarios en 30 días")],
                    ["package", "Ofertas publicadas", entero(r.ofertas), nuevo(r.ofertas30d, "en 30 días")],
                    ["tag", "Precio promedio", dinero(r.precioPromedio), "por unidad, todas las categorías"],
                    [
                      "gavel",
                      "Subastas activas",
                      entero(r.subastasActivas),
                      <>
                        <strong>{entero(r.subastasCerradas)}</strong> finalizadas
                      </>,
                    ],
                    ["coins", "Valor en subasta", dineroCorto(r.valorEnSubasta), "suma de las pujas actuales"],
                    ["hand-click", "Pujas realizadas", entero(r.pujas), nuevo(r.pujas30d, "en 30 días")],
                    ["messages", "Mensajes", entero(r.mensajes), nuevo(r.mensajes30d, "en 30 días")],
                  ] as [string, string, string, ReactNode][]
                ).map(([icono, titulo, valor, pie]) => (
                  <div className="kpi" key={icono}>
                    <div className="kpi-cabecera">
                      <span>{titulo}</span>
                      <span className="kpi-icono">
                        <i className={`ti ti-${icono}`} aria-hidden="true" />
                      </span>
                    </div>
                    <div className="kpi-valor" title={valor}>
                      {valor}
                    </div>
                    <div className="kpi-pie">{pie}</div>
                  </div>
                ))}
            </section>

            {/* ACTIVIDAD PROPIA SEGÚN EL ROL */}
            {mia && (
              <section className="mi-actividad" id="seccionMiActividad">
                <h2>
                  <i className="ti ti-user-star" aria-hidden="true" /> <span id="tituloMiActividad">{mia.titulo}</span>
                </h2>
                <div className="mini-kpis" id="miActividadGrid">
                  {mia.filas.map(([etq, val]) => (
                    <div className="mini-kpi" key={etq}>
                      <div className="etq">{etq}</div>
                      <div className="val">{val}</div>
                    </div>
                  ))}
                </div>
                <MisTratos key={tratos} rol={d!.miActividad.rol} avisar={avisar} alCancelar={() => cargar(meses)} />
              </section>
            )}

            {/* ACTIVIDAD EN EL TIEMPO + DEPARTAMENTOS */}
            <div className="fila fila-2-1">
              <article className="card">
                <div className="card-cabecera">
                  <div>
                    <h2>
                      <i className="ti ti-chart-line" aria-hidden="true" /> Actividad de la plataforma
                    </h2>
                    <p className="card-sub" id="subActividad">
                      Nuevos registros, ofertas publicadas y pujas por mes{d ? ` · últimos ${d.periodoMeses} meses` : ""}
                    </p>
                  </div>
                  <BotonVista tabla={tablas.actividad} alternar={() => alternar("actividad")} />
                </div>
                <Leyenda
                  oculta={tablas.actividad}
                  series={[
                    { nombre: "Registros", color: "var(--serie-1)" },
                    { nombre: "Ofertas", color: "var(--serie-2)" },
                    { nombre: "Pujas", color: "var(--serie-3)" },
                  ]}
                />
                <div className="grafica grafica-alta" id="graficaActividadWrap" hidden={tablas.actividad}>
                  {d && totalActividad === 0 ? (
                    <Vacio icono="chart-line" texto="Sin actividad registrada en este periodo." />
                  ) : (
                    <canvas ref={lienzoActividad} id="graficaActividad" aria-label="Gráfica de actividad mensual" role="img" />
                  )}
                </div>
                <div className="tabla-wrap" id="tablaActividad" hidden={!tablas.actividad}>
                  {d && (
                    <Tabla
                      columnas={[{ titulo: "Mes" }, { titulo: "Registros", num: true }, { titulo: "Ofertas", num: true }, { titulo: "Pujas", num: true }]}
                      filas={d.actividad.map((a) => [nombreMes(a.mes, true), entero(a.registros), entero(a.ofertas), entero(a.pujas)])}
                    />
                  )}
                </div>
              </article>

              <article className="card">
                <div className="card-cabecera">
                  <div>
                    <h2>
                      <i className="ti ti-map-2" aria-hidden="true" /> Usuarios por departamento
                    </h2>
                    <p className="card-sub">Proveedores y emprendedores registrados</p>
                  </div>
                  <BotonVista tabla={tablas.departamentos} alternar={() => alternar("departamentos")} />
                </div>
                <Leyenda
                  oculta={tablas.departamentos}
                  series={[
                    { nombre: "Proveedores", color: "var(--serie-1)" },
                    { nombre: "Emprendedores", color: "var(--serie-2)" },
                  ]}
                />
                <div
                  className="grafica grafica-alta"
                  id="graficaDepartamentosWrap"
                  hidden={tablas.departamentos}
                  style={d?.departamentos.length ? { height: Math.max(220, d.departamentos.length * 34 + 50) } : undefined}
                >
                  {d && !d.departamentos.length ? (
                    <Vacio icono="map-off" texto="Todavía no hay usuarios registrados." />
                  ) : (
                    <canvas ref={lienzoDepartamentos} id="graficaDepartamentos" aria-label="Gráfica de usuarios por departamento" role="img" />
                  )}
                </div>
                <div className="tabla-wrap" id="tablaDepartamentos" hidden={!tablas.departamentos}>
                  {d && (
                    <Tabla
                      columnas={[
                        { titulo: "Departamento" },
                        { titulo: "Proveedores", num: true },
                        { titulo: "Emprendedores", num: true },
                        { titulo: "Total", num: true },
                      ]}
                      filas={d.departamentos.map((x) => [
                        x.departamento,
                        entero(x.proveedores),
                        entero(x.emprendedores),
                        <strong key="t">{entero(x.proveedores + x.emprendedores)}</strong>,
                      ])}
                    />
                  )}
                </div>
              </article>
            </div>

            {/* CATEGORÍAS */}
            <div className="fila fila-1-1">
              <article className="card">
                <div className="card-cabecera">
                  <div>
                    <h2>
                      <i className="ti ti-category" aria-hidden="true" /> Ofertas por categoría
                    </h2>
                    <p className="card-sub">Materiales publicados en cada categoría</p>
                  </div>
                  <BotonVista tabla={tablas.categorias} alternar={() => alternar("categorias")} />
                </div>
                <div
                  className="grafica grafica-media"
                  id="graficaCategoriasWrap"
                  hidden={tablas.categorias}
                  style={d?.categorias.length ? { height: Math.max(200, d.categorias.length * 32 + 50) } : undefined}
                >
                  {d && !d.categorias.length ? (
                    <Vacio icono="package-off" texto="Todavía no hay ofertas publicadas." />
                  ) : (
                    <canvas ref={lienzoCategorias} id="graficaCategorias" aria-label="Gráfica de ofertas por categoría" role="img" />
                  )}
                </div>
                <div className="tabla-wrap" id="tablaCategoriasConteo" hidden={!tablas.categorias}>
                  {d && (
                    <Tabla
                      columnas={[{ titulo: "Categoría" }, { titulo: "Ofertas", num: true }, { titulo: "Precio promedio", num: true }]}
                      filas={d.categorias.map((c) => [c.categoria, entero(c.ofertas), dinero(c.precioPromedio)])}
                    />
                  )}
                </div>
              </article>

              <article className="card">
                <div className="card-cabecera">
                  <div>
                    <h2>
                      <i className="ti ti-receipt-2" aria-hidden="true" /> Precios de referencia
                    </h2>
                    <p className="card-sub">Mínimo, promedio y máximo por categoría (C$)</p>
                  </div>
                </div>
                <div className="tabla-wrap" id="tablaPrecios">
                  {d &&
                    (d.categorias.length ? (
                      <Tabla
                        columnas={[
                          { titulo: "Categoría" },
                          { titulo: "Ofertas", num: true },
                          { titulo: "Mínimo", num: true },
                          { titulo: "Promedio", num: true },
                          { titulo: "Máximo", num: true },
                        ]}
                        filas={d.categorias.map((c) => [
                          c.categoria,
                          entero(c.ofertas),
                          dinero(c.precioMinimo),
                          <strong key="p">{dinero(c.precioPromedio)}</strong>,
                          dinero(c.precioMaximo),
                        ])}
                      />
                    ) : (
                      <Vacio icono="receipt-off" texto="Los precios aparecerán cuando haya ofertas publicadas." />
                    ))}
                </div>
              </article>
            </div>

            {/* SUBASTAS EN CURSO */}
            <article className="card" style={{ marginBottom: 18 }}>
              <div className="card-cabecera">
                <div>
                  <h2>
                    <i className="ti ti-gavel" aria-hidden="true" /> Subastas en curso
                  </h2>
                  <p className="card-sub" id="subSubastas">
                    {d
                      ? `${entero(d.subastas.length)} ${d.subastas.length === 1 ? "lote activo" : "lotes activos"} · ordenados por número de pujas`
                      : "Lotes activos ordenados por número de pujas"}
                  </p>
                </div>
                <label className="sr-only" htmlFor="buscarSubasta">
                  Buscar subasta
                </label>
                <input
                  type="search"
                  id="buscarSubasta"
                  className="buscador-tabla"
                  placeholder="Buscar lote o proveedor…"
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                />
              </div>
              <div className="tabla-wrap" id="tablaSubastas">
                {d &&
                  (!d.subastas.length ? (
                    <Vacio icono="gavel" texto="No hay subastas activas en este momento." />
                  ) : !filtradas.length ? (
                    <Vacio icono="search-off" texto="Ningún lote coincide con la búsqueda." />
                  ) : (
                    <>
                      <table className="tabla">
                        <thead>
                          <tr>
                            <th>Lote</th>
                            <th className="num">Precio base</th>
                            <th className="num">Puja actual</th>
                            <th>Incremento</th>
                            <th className="num">Pujas</th>
                            <th>Cierra en</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {visibles.map((s) => {
                            const inc = s.precioBase > 0 ? ((s.precioActual - s.precioBase) / s.precioBase) * 100 : 0;
                            const pronto = (new Date(s.fechaFin).getTime() - Date.now()) / 3600000 < 24;
                            return (
                              <tr key={s.id}>
                                <td>
                                  <div className="lote">
                                    {nombreLote(s.lote)} {s.esMia && <span className="chip chip-mia">Tu lote</span>}
                                  </div>
                                  <div className="secundario">{s.proveedor}</div>
                                </td>
                                <td className="num">{dinero(s.precioBase)}</td>
                                <td className="num">
                                  <strong>{dinero(s.precioActual)}</strong>
                                </td>
                                <td>
                                  <div className="barra-inc" title="Incremento sobre el precio base">
                                    <div className="pista">
                                      <div className="relleno" style={{ width: `${(Math.max(0, inc) / maxInc) * 100}%` }} />
                                    </div>
                                    <span>+{porcentaje(inc)}</span>
                                  </div>
                                </td>
                                <td className="num">{entero(s.pujas)}</td>
                                <td>
                                  <span className={`chip ${pronto ? "chip-pronto" : "chip-normal"}`}>
                                    <i className={`ti ti-${pronto ? "alarm" : "clock"}`} aria-hidden="true" />
                                    {pronto ? "Cierra pronto · " : ""}
                                    {tiempoRestante(s.fechaFin)}
                                  </span>
                                </td>
                                <td>
                                  <Link className="enlace" href="/mercado#tab-auctions">
                                    Ver lote →
                                  </Link>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {filtradas.length > LIMITE_SUBASTAS && (
                        <div style={{ textAlign: "center", marginTop: 12 }}>
                          <button className="btn btn-ghost" type="button" onClick={() => setVerTodas((v) => !v)}>
                            {verTodas ? "Mostrar menos" : `Mostrar las ${entero(filtradas.length)} subastas`}
                          </button>
                        </div>
                      )}
                    </>
                  ))}
              </div>
            </article>

            {/* PUJAS RECIENTES + ACCIONES */}
            <div className="fila fila-1-1">
              <article className="card">
                <div className="card-cabecera">
                  <div>
                    <h2>
                      <i className="ti ti-activity" aria-hidden="true" /> Pujas recientes
                    </h2>
                    <p className="card-sub">Últimos movimientos en las subastas</p>
                  </div>
                </div>
                <ul className="lista-pujas" id="listaPujas">
                  {d &&
                    (!d.pujasRecientes.length ? (
                      <li style={{ border: "none" }}>
                        <Vacio icono="hand-off" texto="Todavía no hay pujas registradas." />
                      </li>
                    ) : (
                      d.pujasRecientes.slice(0, 8).map((p, i) => (
                        <li key={i}>
                          <span className="puja-icono">
                            <i className="ti ti-gavel" aria-hidden="true" />
                          </span>
                          <div className="puja-info">
                            <strong title={nombreLote(p.lote)}>{nombreLote(p.lote)}</strong>
                            <span>
                              {haceCuanto(p.fecha)}
                              {p.esMia && (
                                <>
                                  {" · "}
                                  <span className="chip chip-mia">Tu puja</span>
                                </>
                              )}
                              {d.esAdmin && p.postor ? ` · ${p.postor}` : ""}
                            </span>
                          </div>
                          <span className="puja-monto">{dinero(p.monto)}</span>
                        </li>
                      ))
                    ))}
                </ul>
              </article>

              {rol === "proveedor" ? (
                <PublicarMaterial avisar={avisar} alPublicar={() => cargar(meses)} />
              ) : (
                <article className="card" id="cardAccesos">
                  <div className="card-cabecera">
                    <div>
                      <h2>
                        <i className="ti ti-bolt" aria-hidden="true" /> Accesos rápidos
                      </h2>
                      <p className="card-sub">Lo que más usas en EntreLazados</p>
                    </div>
                  </div>
                  <div className="accesos" id="listaAccesos">
                    {accesos.map((a) => (
                      <Link className={`acceso ${a.clase}`} href={a.href} key={a.href}>
                        <i className={`ti ti-${a.icono}`} aria-hidden="true" />
                        <div>
                          <strong>{a.titulo}</strong>
                          <span>{a.texto}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </article>
              )}
            </div>
          </div>
        </main>
      </div>

      <div className={`toast${toast.visible ? " visible" : ""}${toast.error ? " error" : ""}`} id="toast" role="status" aria-live="polite">
        {toast.texto}
      </div>
    </>
  );
}
