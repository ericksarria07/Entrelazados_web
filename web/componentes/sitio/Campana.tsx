// ==========================================================================
// CAMPANA DE NOTIFICACIONES (antes public/notificaciones.js)
//
// - Al abrir la página pide GET /api/notificaciones.
// - Las nuevas llegan por tiempo real ("notificacion:nueva"): suben al principio,
//   la campana se mueve y aparece un aviso flotante unos segundos.
// - Al hacer clic en una se marca como leída y se va a su página.
// ==========================================================================
"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useEventoTiempoReal } from "./ProveedorSitio";
import { rutaNueva } from "@/lib/cliente/rutas";
import "@/app/estilos/campana.css";

type Notificacion = {
  id: number;
  tipo: string;
  titulo: string;
  mensaje: string;
  enlace?: string | null;
  leida: boolean;
  fecha: string;
};

const ICONOS: Record<string, string> = {
  PujaSuperada: "ti-trending-up",
  PujaRecibida: "ti-hammer",
  SubastaGanada: "ti-trophy",
  SubastaTerminada: "ti-flag-check",
  SubastaCancelada: "ti-ban",
  TratoActualizado: "ti-truck-delivery",
  CalificacionRecibida: "ti-star",
  AlertaBusqueda: "ti-bell-ringing",
  FavoritoRebajado: "ti-heart",
};

function hace(fecha: string) {
  const seg = Math.max(0, (Date.now() - new Date(fecha).getTime()) / 1000);
  if (seg < 60) return "Hace un momento";
  if (seg < 3600) return `Hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `Hace ${Math.floor(seg / 3600)} h`;
  const dias = Math.floor(seg / 86400);
  return dias === 1 ? "Ayer" : dias < 7 ? `Hace ${dias} días` : new Date(fecha).toLocaleDateString("es-NI");
}

export default function Campana() {
  const router = useRouter();
  const ruta = usePathname();
  const [lista, setLista] = useState<Notificacion[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [cargado, setCargado] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState({ top: 0, left: 0 });
  const [sacudir, setSacudir] = useState(0);
  const [aviso, setAviso] = useState<{ n: Notificacion; visible: boolean } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const relojAviso = useRef<ReturnType<typeof setTimeout>>(undefined);
  // El panel va en <body> (createPortal): solo existe en el navegador
  const montado = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/notificaciones");
      if (!res.ok) return;
      const datos = (await res.json()) as { notificaciones: Notificacion[]; noLeidas: number };
      setLista(datos.notificaciones);
      setNoLeidas(datos.noLeidas);
      setCargado(true);
    } catch {
      /* sin conexión: se intenta al reconectar */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(cargar, 0);
    return () => clearTimeout(t);
  }, [cargar]);

  const ubicar = useCallback(() => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const ancho = panel.current?.offsetWidth || Math.min(380, window.innerWidth - 24);
    setPosicion({ top: r.bottom + 8, left: Math.max(12, Math.min(r.right - ancho, window.innerWidth - ancho - 12)) });
  }, []);

  const cerrar = useCallback(() => setAbierto(false), []);

  // Cerrar al hacer clic fuera, con Escape, y reubicar al cambiar el tamaño
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || boton.current?.contains(t)) return;
      setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener("click", fuera);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", ubicar);
    return () => {
      document.removeEventListener("click", fuera);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", ubicar);
    };
  }, [abierto, ubicar]);

  function alternar() {
    if (abierto) return setAbierto(false);
    ubicar();
    setAbierto(true);
    cargar();
  }

  function abrirNotificacion(n: Notificacion) {
    if (!n.leida) {
      setLista((l) => l.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
      setNoLeidas((c) => Math.max(0, c - 1));
      fetch(`/api/notificaciones/${n.id}/leida`, { method: "PUT" }).catch(() => {});
    }
    if (!n.enlace) return;
    const destino = rutaNueva(n.enlace);
    const [pagina, ancla] = destino.split("#");
    const [soloRuta] = pagina.split("?");
    if (soloRuta === ruta) {
      cerrar();
      if (ancla) {
        // Avisa a la página (p. ej. el Mercado abre la pestaña de subastas) y baja hasta ahí
        history.replaceState(null, "", "#" + ancla);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        setTimeout(() => document.getElementById(ancla)?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } else {
      router.push(destino);
    }
  }

  function marcarTodas() {
    setLista((l) => l.map((n) => ({ ...n, leida: true })));
    setNoLeidas(0);
    fetch("/api/notificaciones/leidas", { method: "PUT" }).catch(() => {});
  }

  useEventoTiempoReal<Notificacion>("notificacion:nueva", (n) => {
    if (!n || !n.id) return;
    let sumar = true;
    setLista((l) => {
      const yaEstaba = l.find((x) => x.id === n.id);
      sumar = !yaEstaba || yaEstaba.leida;
      // Una notificación agrupada (misma subasta) vuelve a subir con el texto nuevo
      return [n, ...l.filter((x) => x.id !== n.id)].slice(0, 30);
    });
    if (sumar) setNoLeidas((c) => c + 1);
    setSacudir((s) => s + 1);
    clearTimeout(relojAviso.current);
    setAviso({ n, visible: false });
    requestAnimationFrame(() => requestAnimationFrame(() => setAviso({ n, visible: true })));
    relojAviso.current = setTimeout(() => {
      setAviso((a) => (a ? { ...a, visible: false } : a));
      relojAviso.current = setTimeout(() => setAviso(null), 300);
    }, 6000);
  });
  // Al reconectarse pudo haberse perdido algo: se vuelve a pedir la lista
  useEventoTiempoReal<{ conectado: boolean }>("conexion", (d) => {
    if (d?.conectado) cargar();
  });
  useEffect(() => () => clearTimeout(relojAviso.current), []);

  const titulo = noLeidas ? `${noLeidas} notificación${noLeidas === 1 ? "" : "es"} sin leer` : "Notificaciones";

  return (
    <>
      <button
        ref={boton}
        type="button"
        className={`campana-ent${sacudir ? " sacudir" : ""}`}
        key={`campana-${sacudir}`}
        aria-haspopup="true"
        aria-expanded={abierto}
        title={titulo}
        aria-label={titulo}
        onClick={(e) => {
          e.stopPropagation();
          alternar();
        }}
      >
        <i className="ti ti-bell" aria-hidden="true" />
        <span className="campana-num" hidden={noLeidas === 0}>
          {noLeidas > 99 ? "99+" : noLeidas}
        </span>
      </button>

      {montado &&
        createPortal(
          <>
            <div
              ref={panel}
              className={`panel-notif${abierto ? " abierto" : ""}`}
              role="dialog"
              aria-label="Notificaciones"
              style={{ top: posicion.top, left: posicion.left }}
            >
              <div className="panel-notif-cab">
                <strong>Notificaciones</strong>
                <button type="button" className="marcar-todas" disabled={noLeidas === 0} onClick={marcarTodas}>
                  Marcar todas como leídas
                </button>
              </div>
              <ul className="panel-notif-lista">
                {lista.length === 0 ? (
                  <li className="panel-notif-vacio">
                    <i className="ti ti-bell-off" aria-hidden="true" />
                    {cargado ? "No tienes notificaciones todavía." : "Cargando…"}
                  </li>
                ) : (
                  lista.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={`item-notif${n.leida ? "" : " no-leida"}`}
                        onClick={() => abrirNotificacion(n)}
                      >
                        <span className="icono">
                          <i className={`ti ${ICONOS[n.tipo] || "ti-bell"}`} aria-hidden="true" />
                        </span>
                        <span className="texto">
                          <span className="titulo">{n.titulo}</span>
                          <span className="mensaje" style={{ display: "block" }}>
                            {n.mensaje}
                          </span>
                          <span className="cuando" style={{ display: "block" }}>
                            {hace(n.fecha)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            {aviso && (
              <div
                className={`aviso-notif${aviso.visible ? " visible" : ""}`}
                role="status"
                onClick={() => {
                  setAviso(null);
                  abrirNotificacion(aviso.n);
                }}
              >
                <i className={`ti ${ICONOS[aviso.n.tipo] || "ti-bell"}`} aria-hidden="true" />
                <div>
                  <div className="titulo">{aviso.n.titulo}</div>
                  <div className="mensaje">{aviso.n.mensaje}</div>
                </div>
              </div>
            )}
          </>,
          document.body
        )}
    </>
  );
}
