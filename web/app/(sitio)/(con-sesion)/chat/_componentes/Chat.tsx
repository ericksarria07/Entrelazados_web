// ==========================================================================
// CHAT: contactos, conversación, Kan dentro del chat y vista de celular
// - Los mensajes nuevos llegan por tiempo real ("chat:mensaje"); si no hay conexión
//   en vivo, se pregunta cada 2 s (y de respaldo cada 15 s aunque la haya).
// - /chat?contacto=ID abre directamente esa conversación.
// - Todo el texto lo escapa JSX: lo único con formato es **negrita** en lo que dice Kan.
// ==========================================================================
"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { conNegritas } from "@/componentes/sitio/Kan";
import { useEventoTiempoReal, useSitio } from "@/componentes/sitio/ProveedorSitio";
import { api, conJSON } from "@/lib/cliente/api";
import { preguntarAKan, type MensajeHistorialKan } from "@/lib/cliente/kan";

type Contacto = {
  UsuarioID: number;
  NombreRazonSocial: string | null;
  TipoRol: string;
  NombreDepartamento: string | null;
  NoLeidos?: number;
};
type MensajeBD = { RemitenteID: number; ContenidoTexto: string; FechaEnvio: string; EsLeido: boolean };
type MensajeKan = { texto: string; mio: boolean; hora: string };

const POSES = {
  saludando: "/randal-saludando.webp",
  telefono: "/randal-telefono.webp",
  dudando: "/randal-dudando.webp",
  respondiendo: "/randal-principal.webp",
};
type Pose = keyof typeof POSES;

const SEGUIMIENTO_KAN = "¿Tienes alguna otra pregunta o duda?";

// Preguntas rápidas de Kan en el chat: [botón, pregunta, respuesta]
const OPCIONES_KAN: Record<"proveedor" | "emprendedor", { saludo: string; opciones: [string, string, string][] }> = {
  proveedor: {
    saludo: "¡Hola! 👋 Soy **Kan**. ¿Quieres ayuda para saber cómo publicar ofertas de materia prima o abrir una subasta?",
    opciones: [
      [
        "➕ ¿Cómo publicar ofertas?",
        "¿Cómo publico mi materia prima?",
        "Si eres proveedor, dirígete al **Mercado** y presiona el botón **+ Publicar Oferta** arriba a la derecha. Añade el título, precio, categoría y fotos.",
      ],
      [
        "🔨 ¿Cómo crear subastas?",
        "¿Cómo abro una subasta de lotes?",
        "En el Mercado, ve a la pestaña **Subastas Activas** y presiona **+ Crear Subasta** para ofrecer materiales al mejor postor.",
      ],
      [
        "📍 Envíos y entregas",
        "¿Cómo se coordinan las entregas?",
        "El costo y método de entrega se negocia libremente entre emprendedor y proveedor mediante los mensajes privados.",
      ],
    ],
  },
  emprendedor: {
    saludo: "¡Hola! 👋 Soy **Kan**. ¿Quieres ayuda para encontrar insumos de calzado, pujar en subastas o contactar proveedores?",
    opciones: [
      [
        "🛍️ ¿Cómo comprar insumos?",
        "¿Cómo puedo comprar materiales de calzado?",
        "Para comprar, ingresa a la sección **Mercado**. Ahí verás los lotes e insumos publicados. Puedes seleccionar **Contactar Proveedor** para coordinar detalles directamente por este chat.",
      ],
      [
        "🔨 ¿Cómo pujar en subastas?",
        "¿Cómo realizo una puja en las subastas?",
        "Dirígete a la pestaña **Subastas Activas** dentro del Mercado, coloca un monto superior a la oferta actual y presiona **Pujar**.",
      ],
      [
        "🗺️ Ver mapa de proveedores",
        "¿Cómo ubico curtiembres o talleres cercanos?",
        "Ingresa a la pestaña **Mapa de Proveedores** en el Mercado para ver los talleres y curtiembres verificados en Nicaragua.",
      ],
    ],
  },
};

const horaAhora = () => new Date().toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit", hour12: true });
const iniciales = (nombre: string) =>
  nombre
    .split(" ")
    .map((p) => p[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

export default function Chat() {
  const { usuario, conectado, noLeidos, actualizarNoLeidos } = useSitio();
  const miId = usuario?.id ?? 0;
  const miRol = (usuario?.rol || "").toLowerCase().trim();
  const params = useSearchParams();
  const contactoInicial = Number(params.get("contacto")) || null;

  const [contactos, setContactos] = useState<Contacto[] | null>(null);
  const [errorContactos, setErrorContactos] = useState(false);
  const [seleccion, setSeleccion] = useState<"kan" | number | null>(null);
  const [movil, setMovil] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeBD[]>([]);
  const [kan, setKan] = useState<MensajeKan[]>([]);
  // Mientras llega la respuesta de la IA no se manda otra pregunta a Kan
  const [kanEscribiendo, setKanEscribiendo] = useState(false);
  const [pose, setPose] = useState<Pose>("saludando");
  const [poseVisible, setPoseVisible] = useState(true);
  const [texto, setTexto] = useState("");
  const [avisoNoLeidos, setAvisoNoLeidos] = useState(false);
  useEventoTiempoReal("no-leidos", () => setAvisoNoLeidos(true));
  const area = useRef<HTMLDivElement>(null);
  const ultimaCarga = useRef(0);
  const abrioInicial = useRef(false);
  const conectadoRef = useRef(conectado);
  useEffect(() => {
    conectadoRef.current = conectado;
  }, [conectado]);

  const contacto = typeof seleccion === "number" ? contactos?.find((c) => c.UsuarioID === seleccion) : undefined;
  const kanTextos = OPCIONES_KAN[miRol === "proveedor" ? "proveedor" : "emprendedor"];

  const cargarContactos = useCallback(async () => {
    try {
      const res = await api(`/api/chat/contactos?userId=${miId}`);
      if (!res.ok) throw new Error("Error en la respuesta del servidor");
      setContactos((await res.json()) as Contacto[]);
      setErrorContactos(false);
    } catch (error) {
      console.error("Error al cargar contactos:", error);
      setErrorContactos(true);
    }
  }, [miId]);

  useEffect(() => {
    const t = setTimeout(cargarContactos, 0);
    return () => clearTimeout(t);
  }, [cargarContactos]);

  const cargarMensajes = useCallback(
    async (id: number, primera = false) => {
      ultimaCarga.current = Date.now();
      try {
        const res = await api(`/api/chat/mensajes?remitenteId=${miId}&destinatarioId=${id}`);
        if (!res.ok) return;
        setMensajes((await res.json()) as MensajeBD[]);
        // Al abrir la conversación sus mensajes quedan leídos: se actualiza el contador del menú
        if (primera) actualizarNoLeidos();
      } catch (error) {
        console.error("Error sincronizando chat:", error);
      }
    },
    [miId, actualizarNoLeidos]
  );

  // Conversación abierta: primera carga y respaldo por si no hay tiempo real
  useEffect(() => {
    if (typeof seleccion !== "number") return;
    const t = setTimeout(() => cargarMensajes(seleccion, true), 0);
    const reloj = setInterval(() => {
      if (conectadoRef.current && Date.now() - ultimaCarga.current < 15000) return;
      cargarMensajes(seleccion);
    }, 2000);
    return () => {
      clearTimeout(t);
      clearInterval(reloj);
    };
  }, [seleccion, cargarMensajes]);

  // Baja al último mensaje si ya estaba abajo
  const estabaAbajo = useRef(true);
  useEffect(() => {
    const el = area.current;
    if (el && estabaAbajo.current) el.scrollTop = el.scrollHeight;
  }, [mensajes, kan, seleccion]);

  // /chat?contacto=ID abre esa conversación
  useEffect(() => {
    if (abrioInicial.current || !contactos || !contactoInicial) return;
    if (contactos.some((c) => c.UsuarioID === contactoInicial)) {
      abrioInicial.current = true;
      const t = setTimeout(() => {
        abrir(contactoInicial);
        document.getElementById(`contacto-${contactoInicial}`)?.scrollIntoView({ block: "nearest" });
      }, 0);
      return () => clearTimeout(t);
    }
  }, [contactos, contactoInicial]);

  // TIEMPO REAL: llegó un mensaje (o lo envié desde otra pestaña)
  useEventoTiempoReal<{ remitenteId?: number; destinatarioId?: number }>("chat:mensaje", (d) => {
    const otro = d?.remitenteId === miId ? d?.destinatarioId : d?.remitenteId;
    if (typeof seleccion === "number" && (otro === seleccion || !otro)) cargarMensajes(seleccion);
    // Alguien que todavía no estaba en la lista de contactos
    if (otro && contactos && !contactos.some((c) => c.UsuarioID === otro)) cargarContactos();
  });

  function abrir(id: number) {
    estabaAbajo.current = true;
    setMensajes([]);
    setSeleccion(id);
    setMovil(true);
  }

  function abrirKan() {
    estabaAbajo.current = true;
    setSeleccion("kan");
    setMovil(true);
    setKan([]);
    cambiarPose("saludando");
  }

  function cambiarPose(nueva: Pose) {
    setPoseVisible(false);
    setTimeout(() => {
      setPose(nueva);
      setPoseVisible(true);
    }, 150);
  }

  const agregarKan = (t: string, mio: boolean) => setKan((k) => [...k, { texto: t, mio, hora: horaAhora() }]);

  function secuenciaKan(respuesta: string) {
    cambiarPose("telefono");
    setTimeout(() => {
      cambiarPose("respondiendo");
      agregarKan(respuesta, false);
      setTimeout(() => {
        cambiarPose("dudando");
        agregarKan(SEGUIMIENTO_KAN, false);
      }, 3000);
    }, 700);
  }

  async function enviar() {
    const t = texto.trim();
    if (!t) return;
    estabaAbajo.current = true;
    if (seleccion === "kan") {
      if (kanEscribiendo) return;
      // Lo hablado antes (sin la pregunta de seguimiento), para que Kan recuerde la conversación
      const historial: MensajeHistorialKan[] = kan
        .filter((m) => m.texto !== SEGUIMIENTO_KAN)
        .slice(-10)
        .map((m) => ({ rol: m.mio ? "usuario" : "kan", texto: m.texto }));
      agregarKan(t, true);
      setTexto("");
      cambiarPose("telefono");
      setKanEscribiendo(true);
      // La respuesta aparece mientras la IA la escribe: el primer trozo crea el mensaje
      let empezo = false;
      const mostrar = (hastaAhora: string) => {
        if (!empezo) {
          empezo = true;
          cambiarPose("respondiendo");
          agregarKan(hastaAhora, false);
        } else {
          setKan((k) => [...k.slice(0, -1), { ...k[k.length - 1], texto: hastaAhora }]);
        }
      };
      try {
        mostrar(await preguntarAKan(t, historial, mostrar));
      } catch (err) {
        console.error("Error al conectar con Kan IA:", err);
        mostrar("¡Ups! Ocurrió un error al intentar conectarme con mi servidor. Inténtalo de nuevo.");
      } finally {
        setKanEscribiendo(false);
      }
      setTimeout(() => {
        cambiarPose("dudando");
        agregarKan(SEGUIMIENTO_KAN, false);
      }, 3000);
      return;
    }
    if (typeof seleccion !== "number") return;
    try {
      const res = await api("/api/chat/enviar", conJSON("POST", { remitenteId: miId, destinatarioId: seleccion, texto: t }));
      if (res.ok) {
        setTexto("");
        cargarMensajes(seleccion);
      }
    } catch (error) {
      console.error("Error al enviar mensaje:", error);
    }
  }

  // Globito por contacto: la conversación abierta no cuenta (sus mensajes se marcan leídos)
  // Antes del primer aviso de /api/chat/no-leidos se usa lo que trajo la lista de contactos
  const sinLeer = (c: Contacto) => {
    if (c.UsuarioID === seleccion) return 0;
    if (!avisoNoLeidos) return c.NoLeidos || 0;
    return noLeidos.porContacto[String(c.UsuarioID)] ?? 0;
  };

  return (
    <div id="app">
      <div className={`chat-layout${movil ? " mobile-active" : ""}`} id="chat-layout-box">
        <div className="chat-sidebar">
          <div className="sidebar-header" id="rol-title">
            {miRol === "proveedor" ? "💬 Emprendedores Interesados" : "🏭 Proveedores de Materiales"}
          </div>
          <div className="contact-list" id="lista-contactos">
            <div
              className={`contact-item kan-pinned-item${seleccion === "kan" ? " active" : ""}`}
              id="contacto-kan"
              role="button"
              tabIndex={0}
              onClick={abrirKan}
              onKeyDown={(e) => e.key === "Enter" && abrirKan()}
            >
              <div className="contact-avatar-side">
                {/* eslint-disable-next-line @next/next/no-img-element -- pose de Kan en public/ */}
                <img src="/randal-saludando.webp" alt="Kan Avatar" />
              </div>
              <div style={{ overflow: "hidden", flex: 1 }}>
                <strong
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    color: "var(--color-secundario)",
                    fontSize: 14,
                  }}
                >
                  Kan{" "}
                  <span
                    style={{ fontSize: 10, backgroundColor: "var(--color-principal)", color: "white", padding: "1px 6px", borderRadius: 10 }}
                  >
                    Asistente
                  </span>
                </strong>
                <span style={{ fontSize: 11, color: "var(--color-principal)" }}>🟢 Asistente Virtual 24/7</span>
              </div>
            </div>

            {errorContactos ? (
              <div style={{ padding: 15, textAlign: "center", color: "red", fontSize: 12 }}>
                Error al conectar con la lista de usuarios.
              </div>
            ) : !contactos ? (
              <p style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 13 }}>Buscando contactos...</p>
            ) : !contactos.length ? (
              <div style={{ padding: 15, textAlign: "center", color: "#777", fontSize: 13 }}>No hay otros usuarios registrados aún.</div>
            ) : (
              // Llegan primero los que tienen mensajes sin leer y luego las conversaciones recientes
              contactos.map((c) => {
                const n = sinLeer(c);
                return (
                  <div
                    key={c.UsuarioID}
                    className={`contact-item${seleccion === c.UsuarioID ? " active" : ""}`}
                    id={`contacto-${c.UsuarioID}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => abrir(c.UsuarioID)}
                    onKeyDown={(e) => e.key === "Enter" && abrir(c.UsuarioID)}
                  >
                    <div className="contact-avatar-side">{(c.NombreRazonSocial || "").substring(0, 2).toUpperCase()}</div>
                    <div style={{ overflow: "hidden", flex: 1 }}>
                      <strong
                        style={{
                          display: "block",
                          color: "var(--color-secundario)",
                          fontSize: 14,
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                        }}
                      >
                        {c.NombreRazonSocial}
                      </strong>
                      <span style={{ fontSize: 11, color: "var(--color-principal)" }}>
                        {c.TipoRol} · {c.NombreDepartamento || "Nicaragua"}
                      </span>
                    </div>
                    <span className="contacto-no-leidos" id={`no-leidos-${c.UsuarioID}`} hidden={!n}>
                      {n > 99 ? "99+" : n || ""}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="chat-main-area" id="chat-principal">
          {seleccion === null ? (
            <div className="no-chat-placeholder" id="pantalla-vacia">
              <i className="ti ti-message-dots" style={{ fontSize: 48, marginBottom: 12, color: "var(--color-principal)" }} aria-hidden="true" />
              <p style={{ fontSize: 15, fontWeight: 700, color: "var(--color-secundario)" }}>Tus Mensajes Directos</p>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                Selecciona un usuario de la lista lateral para iniciar conversación.
              </p>
            </div>
          ) : (
            <div className="chat-container" id="pantalla-activa" style={{ display: "flex" }}>
              <div className="chat-header">
                <button className="btn-back-chat" onClick={() => setMovil(false)} aria-label="Volver a los contactos">
                  <i className="ti ti-arrow-left" aria-hidden="true" />
                </button>
                <div className="chat-avatar-sm" id="chat-vendor-avatar">
                  {seleccion === "kan" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- pose de Kan en public/
                    <img src="/randal-saludando.webp" alt="Kan Avatar" />
                  ) : (
                    iniciales(contacto?.NombreRazonSocial || "")
                  )}
                </div>
                <div className="chat-hinfo">
                  <div className="chat-hname" id="chat-vendor-name">
                    {seleccion === "kan" ? "Kan (Asistente Virtual)" : contacto?.NombreRazonSocial}
                  </div>
                  <div className="chat-hsub" id="chat-vendor-sub">
                    {seleccion === "kan"
                      ? "Asistente del Sistema EntreLazados"
                      : `Ubicado en ${contacto?.NombreDepartamento || "Nicaragua"}`}
                  </div>
                </div>
              </div>

              {/* BANNER DE POSES DE KAN */}
              {seleccion === "kan" && (
                <div className="kan-chat-banner" id="kanChatBanner" style={{ display: "flex" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- la pose cambia con un fundido */}
                  <img src={POSES[pose]} alt="Kan Pose" id="imgKanChatPose" style={{ opacity: poseVisible ? 1 : 0 }} />
                </div>
              )}

              <div
                className="chat-messages"
                id="chat-msgs"
                aria-busy={seleccion === "kan" && kanEscribiendo}
                ref={area}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  estabaAbajo.current = el.scrollHeight - el.scrollTop <= el.clientHeight + 60;
                }}
              >
                {seleccion === "kan" ? (
                  <>
                    <div className="msg them">
                      <div className="msg-bubble">
                        {conNegritas(kanTextos.saludo)}
                        <div className="kan-quick-options-chat">
                          {kanTextos.opciones.map(([boton, pregunta, respuesta]) => (
                            <button
                              key={boton}
                              className="kan-opt-btn-chat"
                              onClick={() => {
                                agregarKan(pregunta, true);
                                secuenciaKan(respuesta);
                              }}
                            >
                              {boton}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {kan.map((m, i) => (
                      <div className={`msg ${m.mio ? "me" : "them"}`} key={i}>
                        <div className="msg-bubble">{m.mio ? m.texto : conNegritas(m.texto)}</div>
                        <div className="msg-time">{m.hora}</div>
                      </div>
                    ))}
                  </>
                ) : (
                  mensajes.map((m, i) => {
                    const esMio = m.RemitenteID === miId;
                    return (
                      <div className={`msg ${esMio ? "me" : "them"}`} key={i}>
                        <div className="msg-bubble">{m.ContenidoTexto}</div>
                        <div className="msg-time">
                          {new Date(m.FechaEnvio).toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit", hour12: true })}
                          {esMio &&
                            (m.EsLeido ? (
                              <>
                                {" "}
                                <span className="visto" title="Visto">
                                  <i className="ti ti-checks" aria-hidden="true" />
                                </span>
                              </>
                            ) : (
                              <>
                                {" "}
                                <i className="ti ti-check" title="Enviado" aria-hidden="true" />
                              </>
                            ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="chat-input-bar">
                <input
                  className="chat-input"
                  id="chat-text"
                  type="text"
                  placeholder="Escribe un mensaje..."
                  aria-label="Mensaje"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") enviar();
                  }}
                />
                <button className="chat-send" onClick={enviar} aria-label="Enviar">
                  <i className="ti ti-send" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
