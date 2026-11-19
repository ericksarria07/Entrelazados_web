// ==========================================================================
// GRÁFICAS (reportes y dashboard) con Chart.js de npm (antes el CDN 4.4.1).
// Se carga bajo demanda. Los colores salen de las variables CSS del panel
// (--serie-1, --grid, --texto-2...), que cambian en modo oscuro.
// ==========================================================================
import type { Chart as TipoChart, ChartConfiguration } from "chart.js";

let cargando: Promise<typeof TipoChart> | null = null;

export function cargarChart(): Promise<typeof TipoChart> {
  if (!cargando) {
    cargando = import("chart.js/auto").then((m) => {
      const Chart = m.default;
      Chart.defaults.font.family = "var(--fuente-base), 'Source Sans 3', 'Leelawadee', sans-serif";
      Chart.defaults.font.size = 12;
      return Chart;
    });
  }
  return cargando;
}

// Valor de una variable CSS dentro del elemento (p. ej. el .dash del panel)
export const colorVar = (elemento: Element | null, nombre: string) =>
  elemento ? getComputedStyle(elemento).getPropertyValue(nombre).trim() : "";

export const tooltipBase = () => ({
  backgroundColor: "#2a1a12",
  titleColor: "#fff",
  bodyColor: "#f3e9e3",
  padding: 10,
  cornerRadius: 6,
  boxPadding: 4,
  usePointStyle: true,
});

export const ejeValor = (grid: string, extra: Record<string, unknown> = {}) => ({
  beginAtZero: true,
  grid: { color: grid, drawTicks: false },
  border: { display: false },
  ticks: { padding: 6, ...extra },
});

export const ejeCategoria = (grid: string) => ({
  grid: { display: false },
  border: { color: grid },
  ticks: { padding: 6 },
});

// Dibuja una gráfica en el lienzo y devuelve cómo destruirla
export async function dibujar(lienzo: HTMLCanvasElement, config: ChartConfiguration, colorTexto?: string) {
  const Chart = await cargarChart();
  if (colorTexto) Chart.defaults.color = colorTexto;
  Chart.getChart(lienzo)?.destroy();
  return new Chart(lienzo, config);
}

export type { TipoChart };
