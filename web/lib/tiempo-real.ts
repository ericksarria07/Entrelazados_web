// ==========================================================================
// TIEMPO REAL CON ABLY (reemplaza a servicios/tiempoReal.js, que usaba Socket.IO)
//
// La cuenta de Ably cobra por usuario activo (MAU): exige @ably/pubsub-server en el
// servidor y @ably/pubsub-device en los navegadores (el paquete "ably" se rechaza).
//
// El servidor publica eventos y las páginas abiertas los reciben al instante:
//   Evento               Canal                     Datos
//   puja:nueva           <prefijo>:publico         { subastaId, precioActual, totalPujas }
//   subastas:cambio      <prefijo>:publico         { subastaId?, motivo }
//   chat:mensaje         <prefijo>:usuario:<id>    { remitenteId, destinatarioId }
//   notificacion:nueva   <prefijo>:usuario:<id>    la notificación
//
// Los eventos solo dicen QUÉ cambió; los datos completos se piden a la API, que
// revisa los permisos. Las páginas se suscriben con un token de solo lectura que
// firma GET /api/tiempo-real/token (ver tokenParaNavegador): nadie publica desde el
// navegador ni escucha el canal de otro usuario.
//
//   ABLY_API_KEY         llave de la app de Ably (sin ella, el tiempo real queda apagado
//                        y las páginas siguen preguntando cada cierto tiempo, como antes)
//   ABLY_CANAL_PREFIJO   separa los canales por entorno (por defecto VERCEL_ENV o "local"),
//                        para que una vista previa no reciba eventos de producción
// ==========================================================================
import { type PubSubHttpClient, createHttpClient } from "@ably/pubsub-server";
import crypto from "node:crypto";
import { after } from "next/server";

const TTL_TOKEN_MS = 60 * 60 * 1000; // 1 hora; el SDK del navegador lo renueva solo

let cliente: PubSubHttpClient | null | undefined;

function obtenerCliente(): PubSubHttpClient | null {
  if (cliente === undefined) {
    const llave = (process.env.ABLY_API_KEY ?? "").trim();
    cliente = llave ? createHttpClient({ key: llave }) : null;
  }
  return cliente;
}

export const tiempoRealConfigurado = () => obtenerCliente() !== null;

const prefijo = () => (process.env.ABLY_CANAL_PREFIJO || process.env.VERCEL_ENV || "local").trim();
export const canalPublico = () => `${prefijo()}:publico`;
export const canalUsuario = (usuarioId: number) => `${prefijo()}:usuario:${usuarioId}`;

// Publica después de responder: un aviso que falla nunca hace fallar la acción
function publicar(canal: string, evento: string, datos: unknown) {
  const ably = obtenerCliente();
  if (!ably) return;
  after(() =>
    ably.channels
      .get(canal)
      .publish(evento, datos)
      .catch((err: Error) => console.error(`⚠️ Tiempo real: no se pudo publicar ${evento}:`, err.message))
  );
}

// Avisa a todas las páginas conectadas (solo datos públicos)
export function aTodos(evento: string, datos: unknown): void {
  publicar(canalPublico(), evento, datos);
}

// Avisa a un usuario (en todas sus pestañas abiertas)
export function aUsuario(usuarioId: number, evento: string, datos: unknown): void {
  if (usuarioId) publicar(canalUsuario(usuarioId), evento, datos);
}

// Permiso de solo lectura para el navegador: el canal público y, con sesión, el propio
export async function tokenParaNavegador(usuarioId: number | null) {
  const ably = obtenerCliente();
  if (!ably) return null;
  const canales = { publico: canalPublico(), usuario: usuarioId ? canalUsuario(usuarioId) : null };
  const capability: Record<string, string[]> = { [canales.publico]: ["subscribe"] };
  if (canales.usuario) capability[canales.usuario] = ["subscribe"];
  const tokenRequest = await ably.auth.createTokenRequest({
    // Ably cuenta usuarios activos por clientId: sin sesión, uno anónimo por conexión
    clientId: usuarioId ? `usuario-${usuarioId}` : `anonimo-${crypto.randomUUID()}`,
    capability: JSON.stringify(capability),
    ttl: TTL_TOKEN_MS,
  });
  return { tokenRequest, canales };
}
