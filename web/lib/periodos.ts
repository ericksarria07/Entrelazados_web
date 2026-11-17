// Periodos de los reportes y del dashboard (?meses=3|6|12)
export const PERIODOS = [3, 6, 12];

export const leerMeses = (valor: unknown) => (PERIODOS.includes(Number(valor)) ? Number(valor) : 6);

// Primer día del mes de inicio del periodo (ej. 6 meses = mes actual + 5 anteriores)
export function inicioDelPeriodo(meses: number) {
  const inicio = new Date();
  inicio.setDate(1);
  inicio.setHours(0, 0, 0, 0);
  inicio.setMonth(inicio.getMonth() - (meses - 1));
  return inicio;
}

// Claves "AAAA-MM" de todos los meses del periodo (también los que no tuvieron actividad)
export function mesesDelPeriodo(inicio: Date, meses: number) {
  return Array.from({ length: meses }, (_, i) => {
    const f = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
  });
}
