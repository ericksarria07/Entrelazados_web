// ==========================================================================
// PROVEEDOR DE LAS PÁGINAS CON SESIÓN (antes la mitad de public/sesion.js)
//
// - usuario: lo manda el servidor (cookie leída en app/(sitio)/layout.tsx), así la
//   página no parpadea como "invitado" mientras carga.
// - Tiempo real (Ably, de npm): pide el permiso a /api/tiempo-real/token y reenvía
//   cada aviso como evento del documento "entrelazados:<evento>" (puja:nueva,
//   subastas:cambio, chat:mensaje, notificacion:nueva). Las páginas escuchan con
//   useEventoTiempoReal(). Si no hay tiempo real, siguen preguntando cada tanto.
// - Mensajes sin leer: /api/chat/no-leidos cada 30 s con la pestaña visible, y al
//   instante cuando llega un mensaje (useNoLeidos()).
// ==========================================================================
"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DatosSesion } from "@/lib/sesion";

type NoLeidos = { total: number; porContacto: Record<string, number> };

type Sitio = {
  usuario: DatosSesion | null;
  conectado: boolean;
  noLeidos: NoLeidos;
  actualizarNoLeidos: () => void;
};

const ContextoSitio = createContext<Sitio>({
  usuario: null,
  conectado: false,
  noLeidos: { total: 0, porContacto: {} },
  actualizarNoLeidos: () => {},
});

const EVENTOS = ["puja:nueva", "subastas:cambio", "chat:mensaje", "notificacion:nueva"];
const INTERVALO_NO_LEIDOS_MS = 30000;

const avisar = (nombre: string, detalle: unknown) =>
  document.dispatchEvent(new CustomEvent("entrelazados:" + nombre, { detail: detalle }));

type Permiso = { tokenRequest: unknown; canales: { publico: string; usuario?: string } };

async function pedirPermiso(): Promise<Permiso | null> {
  try {
    const res = await fetch("/api/tiempo-real/token");
    return res.ok ? ((await res.json()) as Permiso) : null;
  } catch {
    return null;
  }
}

// Guarda en localStorage los datos que no son secretos (los que guardaba login.html)
function recordarUsuario(u: DatosSesion) {
  try {
    localStorage.setItem("userId", String(u.id));
    localStorage.setItem("userNombre", u.nombre);
    localStorage.setItem("userRol", u.rol);
    localStorage.setItem("userEmail", u.email);
    localStorage.setItem("userDepartamento", u.departamento);
    if (u.inicio) localStorage.setItem("sesionInicio", String(u.inicio));
    if (u.vence) localStorage.setItem("sesionVence", String(u.vence));
  } catch {
    /* almacenamiento bloqueado */
  }
}

export default function ProveedorSitio({ usuario, children }: { usuario: DatosSesion | null; children: ReactNode }) {
  const [conectado, setConectado] = useState(false);
  const [noLeidos, setNoLeidos] = useState<NoLeidos>({ total: 0, porContacto: {} });
  const conSesion = !!usuario;

  const actualizarNoLeidos = useCallback(async () => {
    if (!conSesion || document.hidden) return;
    try {
      const res = await fetch("/api/chat/no-leidos");
      if (!res.ok) return;
      const datos = (await res.json()) as NoLeidos;
      setNoLeidos(datos);
      avisar("no-leidos", datos);
    } catch {
      /* sin conexión: se intenta en la siguiente vuelta */
    }
  }, [conSesion]);
  const actualizarRef = useRef(actualizarNoLeidos);
  useEffect(() => {
    actualizarRef.current = actualizarNoLeidos;
  }, [actualizarNoLeidos]);

  useEffect(() => {
    if (usuario) recordarUsuario(usuario);
  }, [usuario]);

  // Mensajes sin leer
  useEffect(() => {
    if (!conSesion) return;
    const primera = setTimeout(() => actualizarRef.current(), 0);
    const reloj = setInterval(() => actualizarRef.current(), INTERVALO_NO_LEIDOS_MS);
    const alVolver = () => {
      if (!document.hidden) actualizarRef.current();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearTimeout(primera);
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [conSesion]);

  // Tiempo real
  useEffect(() => {
    if (!conSesion) return;
    let cancelado = false;
    let cerrar: (() => void) | null = null;

    (async () => {
      const permiso = await pedirPermiso();
      if (!permiso || cancelado) return;
      const { createClient } = await import("@ably/pubsub-device");
      if (cancelado) return;
      let primero: unknown = permiso.tokenRequest;
      let estaConectado = false;
      const cliente = createClient({
        // El permiso dura 1 hora; el SDK pide otro solo. Si la sesión ya no sirve, se deja de insistir.
        authCallback: async (_params, listo) => {
          if (primero) {
            listo(null, primero as never);
            primero = null;
            return;
          }
          const nuevo = await pedirPermiso();
          if (nuevo) listo(null, nuevo.tokenRequest as never);
          else {
            listo("sesion-invalida", null);
            cliente.close();
          }
        },
      });
      cerrar = () => cliente.close();
      cliente.connection.on("connected", () => {
        estaConectado = true;
        setConectado(true);
        avisar("conexion", { conectado: true });
      });
      cliente.connection.on(["disconnected", "suspended", "closed", "failed"], () => {
        if (!estaConectado) return;
        estaConectado = false;
        setConectado(false);
        avisar("conexion", { conectado: false });
      });
      const reenviar = (mensaje: { name?: string; data?: unknown }) => {
        if (!mensaje.name || !EVENTOS.includes(mensaje.name)) return;
        avisar(mensaje.name, mensaje.data);
        if (mensaje.name === "chat:mensaje") actualizarRef.current();
      };
      // subscribe() rechaza si la conexión se cierra antes (al salir de la página): no es un error
      cliente.channels.get(permiso.canales.publico).subscribe(reenviar).catch(() => {});
      if (permiso.canales.usuario) cliente.channels.get(permiso.canales.usuario).subscribe(reenviar).catch(() => {});
    })();

    return () => {
      cancelado = true;
      cerrar?.();
    };
  }, [conSesion]);

  return (
    <ContextoSitio.Provider value={{ usuario, conectado, noLeidos, actualizarNoLeidos }}>{children}</ContextoSitio.Provider>
  );
}

export const useSitio = () => useContext(ContextoSitio);
export const useUsuario = () => useContext(ContextoSitio).usuario;
export const useNoLeidos = () => useContext(ContextoSitio).noLeidos;

// Escucha un evento de tiempo real ("puja:nueva", "conexion"...) mientras el componente vive
export function useEventoTiempoReal<T = unknown>(nombre: string, alLlegar: (detalle: T) => void) {
  const ref = useRef(alLlegar);
  useEffect(() => {
    ref.current = alLlegar;
  });
  useEffect(() => {
    const oyente = (e: Event) => ref.current((e as CustomEvent<T>).detail);
    document.addEventListener("entrelazados:" + nombre, oyente);
    return () => document.removeEventListener("entrelazados:" + nombre, oyente);
  }, [nombre]);
}
