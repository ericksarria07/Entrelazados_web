// ==========================================================================
// EXPORTAR A EXCEL (reportes y dashboard). ExcelJS se descarga solo al usarlo.
//   const libro = await libroNuevo();
//   agregarHoja(libro, "Resumen", "Mis ventas", subtitulo, columnas, filas, total);
//   descargarLibro(libro, "EntreLazados_Mis_ventas_2026-11-19.xlsx");
// ==========================================================================
import type { Workbook } from "exceljs";

export type Columna = { clave: string; titulo: string; ancho?: number; formato?: keyof typeof FORMATO | null };
export const FORMATO = {
  dinero: '"C$" #,##0.00',
  entero: "#,##0",
  porcentaje: "0.0%",
  fecha: "dd/mm/yyyy",
  fechaHora: "dd/mm/yyyy hh:mm",
};

export async function libroNuevo(): Promise<Workbook> {
  const modulo = (await import("exceljs")) as unknown as { default?: typeof import("exceljs"); Workbook?: typeof Workbook };
  const ExcelJS = (modulo.Workbook ? modulo : modulo.default) as typeof import("exceljs");
  const libro = new ExcelJS.Workbook();
  libro.creator = "EntreLazados";
  libro.created = new Date();
  return libro;
}

// Fecha para Excel: sin el corrimiento de la zona horaria
export const fechaExcel = (f: string | Date) => {
  const d = new Date(f);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
};

export function agregarHoja(
  libro: Workbook,
  nombre: string,
  titulo: string,
  subtitulo: string,
  columnas: Columna[],
  filas: unknown[][],
  total: unknown[] | null = null,
  // El dashboard además pone filtros en la cabecera y líneas finas entre filas
  { autoFiltro = false, bordes = false } = {}
) {
  const hoja = libro.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 4 }], properties: { tabColor: { argb: "FF7D381B" } } });
  hoja.columns = columnas.map((c) => ({ key: c.clave, width: c.ancho || 16 }));
  const n = columnas.length;
  hoja.mergeCells(1, 1, 1, n);
  hoja.getCell(1, 1).value = titulo;
  hoja.getCell(1, 1).font = { size: 15, bold: true, color: { argb: "FFFFFFFF" } };
  hoja.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3D170A" } };
  hoja.getCell(1, 1).alignment = { vertical: "middle", indent: 1 };
  hoja.getRow(1).height = 28;
  hoja.mergeCells(2, 1, 2, n);
  hoja.getCell(2, 1).value = subtitulo;
  hoja.getCell(2, 1).font = { italic: true, size: 10, color: { argb: "FF6B5A50" } };
  const cab = hoja.getRow(4);
  columnas.forEach((c, i) => {
    const celda = cab.getCell(i + 1);
    celda.value = c.titulo;
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF993D24" } };
    celda.alignment = { horizontal: c.formato ? "right" : "left", vertical: "middle", wrapText: true };
    if (bordes) celda.border = { bottom: { style: "thin", color: { argb: "FF7D381B" } } };
  });
  cab.height = 22;
  filas.forEach((f, idx) => {
    const fila = hoja.addRow(f);
    fila.eachCell({ includeEmpty: true }, (celda, i) => {
      const col = columnas[i - 1];
      if (col?.formato) celda.numFmt = FORMATO[col.formato];
      if (bordes) celda.border = { bottom: { style: "hair", color: { argb: "FFE6DDD4" } } };
      if (idx % 2 === 1) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAF6F2" } };
    });
  });
  if (!filas.length) {
    hoja.addRow(["Sin datos para este periodo."]).getCell(1).font = { italic: true, color: { argb: "FF8D7D73" } };
  } else {
    if (autoFiltro) hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + filas.length, column: n } };
    if (!total) return hoja;
    const fila = hoja.addRow(total);
    fila.eachCell({ includeEmpty: true }, (celda, i) => {
      const col = columnas[i - 1];
      if (col?.formato) celda.numFmt = FORMATO[col.formato];
      celda.font = { bold: true };
      if (bordes) celda.border = { top: { style: "thin", color: { argb: "FF3D170A" } } };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1E7DF" } };
    });
  }
  return hoja;
}

export async function descargarLibro(libro: Workbook, nombre: string) {
  const buffer = await libro.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  setTimeout(() => {
    URL.revokeObjectURL(enlace.href);
    enlace.remove();
  }, 1000);
}

// "2026-11-19" para el nombre del archivo
export function hoyTexto() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
}
