// ==========================================================================
// KAN, EL ASISTENTE FLOTANTE (antes public/kan.js)
//
//   <Kan contexto="mercado" />
//
// - Las preguntas rápidas cambian según la página y el rol; sus respuestas están en
//   lib/cliente/kan-contenido.ts (no gastan IA).
// - Lo que el usuario escribe a mano va a POST /api/chat/ia (Gemini) con los últimos
//   mensajes, para que Kan los recuerde.
// - JSX escapa el texto: lo único que se permite como formato es **negrita**.
// - La conversación se guarda en el navegador y reaparece en cada página hasta cerrar
//   sesión o que venza. Con sesión va en localStorage, atada al usuario y a la hora
//   de inicio de la sesión; sin sesión, en sessionStorage (dura lo que la pestaña).
// ==========================================================================
"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { contenidoKan, type ContextoKan } from "@/lib/cliente/kan-contenido";
import { useUsuario } from "./ProveedorSitio";
import "@/app/estilos/kan.css";

const POSES = {
  saludando: "/randal-saludando.webp",
  telefono: "/randal-telefono.webp",
  dudando: "/randal-dudando.webp",
  respondiendo: "/randal-principal.webp",
  durmiendo: "/randal-durmiendo.webp",
};
type Pose = keyof typeof POSES;
const MINUTOS_PARA_DORMIR = 2;
const SEGUIMIENTO = "¿Tienes alguna otra pregunta o duda?";
const CLAVE_GUARDADO = "kan-conversacion";
const MAX_GUARDADOS = 40; // mensajes que se conservan entre páginas
const MAX_HISTORIAL = 10; // mensajes anteriores que se le mandan a Kan (IA)

type Mensaje = { texto: string; quien: "user" | "bot" };
type Guardado = { usuarioId: string; firma: string; abierta: boolean; mensajes: Mensaje[] };

// **así** → <strong>así</strong>; el resto se muestra como texto
export function conNegritas(texto: string): ReactNode {
  return texto.split(/\*\*(.+?)\*\*/g).map((parte, i) => (i % 2 ? <strong key={i}>{parte}</strong> : <Fragment key={i}>{parte}</Fragment>));
}

function leer(almacen: "localStorage" | "sessionStorage", clave: string) {
  try {
    return window[almacen].getItem(clave);
  } catch {
    return null;
  }
}

// Sesión actual: usuario, firma (la hora de inicio: cambia en cada login) y si ya venció
function sesionActual() {
  const usuarioId = leer("localStorage", "userId");
  if (!usuarioId) return null;
  const vence = Number(leer("localStorage", "sesionVence")) || 0;
  return {
    usuarioId,
    firma: leer("localStorage", "sesionInicio") || "",
    vencido: vence > 0 && vence * 1000 <= Date.now(),
  };
}
const almacenActual = () => (sesionActual() ? "localStorage" : "sessionStorage");

function cargarGuardado(): { mensajes: Mensaje[]; abierta: boolean } {
  const sesion = sesionActual();
  try {
    const g = JSON.parse(leer(almacenActual(), CLAVE_GUARDADO) || "null") as Guardado | null;
    const deEstaSesion =
      g &&
      Array.isArray(g.mensajes) &&
      (!sesion || (!sesion.vencido && g.usuarioId === sesion.usuarioId && g.firma === sesion.firma));
    if (deEstaSesion) {
      return {
        abierta: !!g.abierta,
        mensajes: g.mensajes
          .filter((m) => m && typeof m.texto === "string" && (m.quien === "user" || m.quien === "bot"))
          .slice(-MAX_GUARDADOS),
      };
    }
  } catch {
    /* guardado dañado: se empieza de cero */
  }
  try {
    window[almacenActual()].removeItem(CLAVE_GUARDADO);
  } catch {
    /* nada */
  }
  return { mensajes: [], abierta: false };
}

function guardar(mensajes: Mensaje[], abierta: boolean) {
  const sesion = sesionActual();
  const datos: Guardado = {
    usuarioId: sesion?.usuarioId ?? "",
    firma: sesion?.firma ?? "",
    abierta,
    mensajes: mensajes.slice(-MAX_GUARDADOS),
  };
  try {
    window[almacenActual()].setItem(CLAVE_GUARDADO, JSON.stringify(datos));
  } catch {
    /* sin espacio o bloqueado */
  }
}

// Para abrir a Kan desde otro botón de la página
export const abrirKan = () => document.dispatchEvent(new CustomEvent("entrelazados:abrir-kan"));

export default function Kan({ contexto = "inicio" }: { contexto?: ContextoKan }) {
  const usuario = useUsuario();
  const contenido = contenidoKan(contexto, usuario?.rol ?? "");
  const [listo, setListo] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [insignia, setInsignia] = useState(true);
  const [pose, setPose] = useState<Pose>("saludando");
  const [poseBanner, setPoseBanner] = useState<Pose>("saludando");
  const [bannerVisible, setBannerVisible] = useState(true);
  const [dormido, setDormido] = useState(false);
  const [texto, setTexto] = useState("");
  const cuerpo = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const relojSueno = useRef<ReturnType<typeof setTimeout>>(undefined);
  const relojes = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abiertaRef = useRef(false);

  const despues = (ms: number, fn: () => void) => relojes.current.push(setTimeout(fn, ms));

  // Lo guardado se lee en el navegador, después de hidratar
  useEffect(() => {
    const t = setTimeout(() => {
      const g = cargarGuardado();
      setMensajes(g.mensajes);
      setAbierta(g.abierta);
      abiertaRef.current = g.abierta;
      if (g.mensajes.length || g.abierta) setInsignia(false);
      setListo(true);
    }, 0);
    const pendientes = relojes.current;
    return () => {
      clearTimeout(t);
      clearTimeout(relojSueno.current);
      pendientes.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (listo) guardar(mensajes, abierta);
  }, [listo, mensajes, abierta]);

  useEffect(() => {
    if (cuerpo.current) cuerpo.current.scrollTop = cuerpo.current.scrollHeight;
  }, [mensajes, abierta]);

  function cambiarPose(nueva: Pose) {
    setBannerVisible(false);
    despues(150, () => {
      setPoseBanner(nueva);
      setBannerVisible(true);
    });
    if (!abiertaRef.current) setPose(nueva);
  }

  // Si nadie habla con Kan por un rato, se queda dormido en su botón
  function reiniciarSueno() {
    clearTimeout(relojSueno.current);
    setDormido(false);
    setPose("saludando");
    relojSueno.current = setTimeout(() => {
      if (!abiertaRef.current) setDormido(true);
    }, MINUTOS_PARA_DORMIR * 60 * 1000);
  }
  // Arranca el reloj de sueño una vez
  useEffect(() => {
    relojSueno.current = setTimeout(() => {
      if (!abiertaRef.current) setDormido(true);
    }, MINUTOS_PARA_DORMIR * 60 * 1000);
    return () => clearTimeout(relojSueno.current);
  }, []);

  const agregar = (texto: string, quien: Mensaje["quien"]) => setMensajes((m) => [...m, { texto: String(texto), quien }]);

  function alternar() {
    const nueva = !abiertaRef.current;
    abiertaRef.current = nueva;
    setAbierta(nueva);
    setInsignia(false);
    if (nueva) setTimeout(() => entrada.current?.focus(), 0);
    cambiarPose("saludando");
    reiniciarSueno();
  }

  useEffect(() => {
    const abrir = () => {
      if (!abiertaRef.current) alternar();
    };
    document.addEventListener("entrelazados:abrir-kan", abrir);
    return () => document.removeEventListener("entrelazados:abrir-kan", abrir);
  });

  // Pregunta rápida: respuesta local, sin gastar la IA
  function responderOpcion(indice: number) {
    const opcion = contenido.opciones[indice];
    if (!opcion) return;
    const [, pregunta, respuesta] = opcion;
    reiniciarSueno();
    agregar(pregunta, "user");
    cambiarPose("telefono");
    despues(700, () => {
      cambiarPose("respondiendo");
      agregar(respuesta, "bot");
      despues(3000, () => {
        cambiarPose("dudando");
        agregar(SEGUIMIENTO, "bot");
      });
    });
  }

  // Texto libre: se lo pregunta a la IA
  async function enviarEscrito() {
    const pregunta = texto.trim();
    if (!pregunta) return;
    setTexto("");
    reiniciarSueno();
    const historial = mensajes
      .filter((m) => m.texto !== SEGUIMIENTO)
      .slice(-MAX_HISTORIAL)
      .map((m) => ({ rol: m.quien === "user" ? "usuario" : "kan", texto: m.texto }));
    agregar(pregunta, "user");
    cambiarPose("telefono");
    try {
      const res = await fetch("/api/chat/ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensajeUsuario: pregunta, historial }),
      });
      const data = (await res.json()) as { respuesta?: string; error?: string; message?: string };
      cambiarPose("respondiendo");
      agregar(data.respuesta || data.error || data.message || "No pude responder en este momento.", "bot");
      despues(3000, () => cambiarPose("dudando"));
    } catch (error) {
      console.error("Error al conectar con Kan:", error);
      cambiarPose("respondiendo");
      agregar("Lo siento, no pude procesar tu solicitud en este momento. Por favor inténtalo de nuevo.", "bot");
    }
  }

  const imgBoton = dormido && !abierta ? POSES.durmiendo : POSES[pose];

  return (
    <div className="kan-componente">
      <button type="button" className="kan-widget-btn" aria-label="Abrir el chat de Kan" onClick={alternar}>
        {/* eslint-disable-next-line @next/next/no-img-element -- poses de Kan en public/, cambian al instante */}
        <img src={imgBoton} alt="Kan, el asistente" />
        <span className="kan-badge" style={insignia ? undefined : { display: "none" }}>
          1
        </span>
      </button>
      <div className={`kan-chat-window${abierta ? " active" : ""}`} role="dialog" aria-label="Chat con Kan">
        <div className="kan-header">
          <div className="kan-header-info">
            <div className="kan-avatar-header">
              {/* eslint-disable-next-line @next/next/no-img-element -- imagen decorativa de public/ */}
              <img src={POSES.saludando} alt="" />
            </div>
            <div>
              <div className="kan-title">
                Kan <span>(Asistente)</span>
              </div>
              <div className="kan-sub">🟢 En línea</div>
            </div>
          </div>
          <button type="button" className="kan-close-btn" aria-label="Cerrar" onClick={alternar}>
            ✕
          </button>
        </div>
        <div className="kan-display-banner">
          {/* eslint-disable-next-line @next/next/no-img-element -- la pose cambia con un fundido */}
          <img src={POSES[poseBanner]} alt="" style={{ opacity: bannerVisible ? 1 : 0 }} />
        </div>
        <div className="kan-body" ref={cuerpo}>
          <div className="kan-msg bot">{conNegritas(contenido.saludo)}</div>
          <div className={`kan-quick-options${contenido.chips ? " chips" : ""}`}>
            {contenido.opciones.map(([boton], i) => (
              <button key={i} type="button" className="kan-opt-btn" onClick={() => responderOpcion(i)}>
                {boton}
              </button>
            ))}
          </div>
          {/* Lo que ya se habló en otras páginas, debajo del saludo y las preguntas de esta */}
          {mensajes.map((m, i) => (
            <div key={i} className={`kan-msg ${m.quien}`}>
              {conNegritas(m.texto)}
            </div>
          ))}
        </div>
        <div className="kan-footer">
          <input
            ref={entrada}
            type="text"
            className="kan-input"
            placeholder="Pregúntale algo a Kan..."
            maxLength={1000}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") enviarEscrito();
            }}
          />
          <button type="button" className="kan-send-btn" aria-label="Enviar" onClick={enviarEscrito}>
            <i className="ti ti-send" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
