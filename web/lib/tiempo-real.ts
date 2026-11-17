// ==========================================================================
// TIEMPO REAL (equivale a servicios/tiempoReal.js)
//
// En Express, Socket.IO avisaba al instante a las páginas abiertas (nueva puja,
// lista de subastas cambiada, notificación nueva...). En Vercel no hay Socket.IO:
// pasa a Ably en la 1.6. Mientras tanto estas funciones no hacen nada y las
// páginas muestran los cambios al recargar.
// ==========================================================================

export function aTodos(evento: string, datos: unknown): void {
  void evento;
  void datos;
}

export function aUsuario(usuarioId: number, evento: string, datos: unknown): void {
  void usuarioId;
  void evento;
  void datos;
}
