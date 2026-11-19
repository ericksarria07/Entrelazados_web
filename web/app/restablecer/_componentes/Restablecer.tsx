"use client";
// Recuperar la contraseña. Misma lógica que la vieja restablecer.html:
//   sin token → pedir el enlace (con ?email= ya escrito si viene del login) → "revisa tu correo"
//   con token del correo → se comprueba → nueva contraseña → listo (al login en 5 s)
//   enlace vencido o usado → pedir uno nuevo
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cerrarSesion, leerJSON, REGEX_EMAIL } from "@/lib/cliente/sesion";

const ESPERA_REENVIO = 60; // segundos, igual que en el servidor
type Vista = "cargando" | "solicitar" | "enviado" | "nueva" | "listo" | "invalido";
type Mensaje = { texto: string; tipo: "error" | "exito" } | null;

const TITULOS: Partial<Record<Vista, string>> = { nueva: "Nueva contraseña", listo: "Contraseña actualizada", invalido: "Enlace no válido" };

function CajaMensaje({ id, mensaje, rol }: { id: string; mensaje: Mensaje; rol: "alert" | "status" }) {
  return (
    <div id={id} className={mensaje ? `mensaje ${mensaje.tipo}` : "mensaje"} role={rol}>
      {mensaje?.texto}
    </div>
  );
}

function Volver() {
  return (
    <div className="enlaces">
      <a href="/login">
        <i className="ti ti-arrow-left" aria-hidden="true" /> Volver a iniciar sesión
      </a>
    </div>
  );
}

const Ocupado = ({ texto }: { texto: string }) => (
  <>
    <i className="ti ti-loader-2 giro" aria-hidden="true" /> {texto}
  </>
);

export function Cargando() {
  return (
    <section className="vista activa" aria-live="polite">
      <p className="cargando">
        <i className="ti ti-loader-2 giro" aria-hidden="true" /> Comprobando tu enlace...
      </p>
    </section>
  );
}

async function enviarSolicitud(correo: string) {
  const res = await fetch("/api/solicitar-recuperacion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: correo }),
  });
  const data = await leerJSON<{ message?: string }>(res);
  if (!res.ok) throw new Error(data.message || "No se pudo enviar el enlace. Intenta de nuevo.");
}

export default function Restablecer() {
  const parametros = useSearchParams();
  const tokenUrl = parametros.get("token");
  const [token, setToken] = useState(tokenUrl);
  const [vista, setVista] = useState<Vista>(tokenUrl ? "cargando" : "solicitar");
  const [correo, setCorreo] = useState(parametros.get("email") ?? "");
  const [correoEnviado, setCorreoEnviado] = useState("");
  const [correoCuenta, setCorreoCuenta] = useState("");
  const [mensajeNueva, setMensajeNueva] = useState<Mensaje>(null);

  // Título de la pestaña según el paso
  useEffect(() => {
    document.title = `${TITULOS[vista] ?? "Recuperar contraseña"} - EntreLazados`;
  }, [vista]);

  // ¿Viene con token del correo? Se comprueba antes de pedir la contraseña nueva
  useEffect(() => {
    if (!tokenUrl) return;
    let vigente = true;
    (async () => {
      try {
        const res = await fetch(`/api/validar-token-recuperacion?token=${encodeURIComponent(tokenUrl)}`);
        const data = await leerJSON<{ valido?: boolean; correo?: string }>(res);
        if (!vigente) return;
        if (!res.ok || !data.valido) return setVista("invalido");
        if (data.correo) setCorreoCuenta(data.correo);
        setVista("nueva");
      } catch {
        // Sin conexión: se deja intentar igual, el servidor validará el token al guardar
        if (!vigente) return;
        setVista("nueva");
        setMensajeNueva({ texto: "No pudimos comprobar el enlace, revisa tu conexión.", tipo: "error" });
      }
    })();
    return () => {
      vigente = false;
    };
  }, [tokenUrl]);

  const quitarTokenDeLaUrl = () => window.history.replaceState(null, "", "/restablecer");

  if (vista === "cargando") return <Cargando />;

  if (vista === "solicitar") {
    return (
      <Solicitar
        correo={correo}
        setCorreo={setCorreo}
        alEnviar={(c) => {
          setCorreoEnviado(c);
          setVista("enviado");
        }}
      />
    );
  }

  if (vista === "enviado") {
    return (
      <Enviado
        correo={correoEnviado}
        otroCorreo={() => {
          setCorreo("");
          setVista("solicitar");
        }}
      />
    );
  }

  if (vista === "nueva") {
    return (
      <NuevaContrasena
        token={token ?? ""}
        correoCuenta={correoCuenta}
        mensaje={mensajeNueva}
        setMensaje={setMensajeNueva}
        alGuardar={async () => {
          // El enlace ya no sirve: se quita de la barra de direcciones y del historial
          quitarTokenDeLaUrl();
          setToken(null);
          // Con la contraseña nueva, la sesión abierta en este navegador se cierra
          await cerrarSesion();
          setVista("listo");
        }}
        invalido={() => setVista("invalido")}
      />
    );
  }

  if (vista === "listo") return <Listo />;

  return (
    <section className="vista activa">
      <div className="icono-grande error">
        <i className="ti ti-link-off" aria-hidden="true" />
      </div>
      <h1>El enlace ya no es válido</h1>
      <p className="subtitulo">
        Puede que haya vencido (dura 1 hora), que ya lo hayas usado o que esté incompleto. Pide uno nuevo, solo toma un momento.
      </p>
      <button
        type="button"
        className="boton"
        id="btn-pedir-nuevo"
        onClick={() => {
          quitarTokenDeLaUrl();
          setToken(null);
          setVista("solicitar");
        }}
      >
        <i className="ti ti-mail-forward" aria-hidden="true" /> Pedir un enlace nuevo
      </button>
      <Volver />
    </section>
  );
}

/* ---------- Paso 1: pedir el enlace ---------- */
function Solicitar({ correo, setCorreo, alEnviar }: { correo: string; setCorreo: (c: string) => void; alEnviar: (c: string) => void }) {
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [invalido, setInvalido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => campo.current?.focus(), []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const limpio = correo.trim();
    if (!REGEX_EMAIL.test(limpio)) {
      setInvalido(true);
      campo.current?.focus();
      setMensaje({ texto: "Escribe un correo válido, por ejemplo usuario@gmail.com.", tipo: "error" });
      return;
    }
    setInvalido(false);
    setMensaje(null);
    setEnviando(true);
    try {
      await enviarSolicitud(limpio);
      alEnviar(limpio);
    } catch (error) {
      const texto = (error as Error).message;
      setMensaje({
        texto: texto === "Failed to fetch" ? "No hay conexión con el servidor. Revisa tu internet e intenta de nuevo." : texto,
        tipo: "error",
      });
      setEnviando(false);
    }
  }

  return (
    <section className="vista activa">
      <h1>¿Olvidaste tu contraseña?</h1>
      <p className="subtitulo">Escribe el correo con el que te registraste y te enviaremos un enlace para crear una nueva.</p>

      <CajaMensaje id="mensaje-solicitar" mensaje={mensaje} rol="alert" />

      <form id="form-solicitar" noValidate onSubmit={enviar}>
        <label htmlFor="correo">Correo electrónico</label>
        <div className="campo">
          <input
            ref={campo}
            type="email"
            id="correo"
            autoComplete="email"
            inputMode="email"
            placeholder="usuario@gmail.com"
            required
            aria-invalid={invalido || undefined}
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
          />
        </div>
        <button type="submit" className="boton" id="btn-solicitar" disabled={enviando}>
          {enviando ? (
            <Ocupado texto="Enviando..." />
          ) : (
            <>
              <i className="ti ti-mail-forward" aria-hidden="true" /> Enviar enlace
            </>
          )}
        </button>
      </form>

      <Volver />
    </section>
  );
}

/* ---------- Paso 2: correo enviado ---------- */
function Enviado({ correo, otroCorreo }: { correo: string; otroCorreo: () => void }) {
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [restantes, setRestantes] = useState(ESPERA_REENVIO);
  const [reenviando, setReenviando] = useState(false);

  // Cuenta regresiva para poder reenviar (se reinicia al reenviar)
  useEffect(() => {
    if (restantes <= 0) return;
    const reloj = setTimeout(() => setRestantes((r) => r - 1), 1000);
    return () => clearTimeout(reloj);
  }, [restantes]);

  async function reenviar() {
    setReenviando(true);
    try {
      await enviarSolicitud(correo);
      setMensaje({ texto: "Te enviamos un correo nuevo. Usa el enlace más reciente: los anteriores ya no sirven.", tipo: "exito" });
      setRestantes(ESPERA_REENVIO);
    } catch {
      setMensaje({ texto: "No se pudo reenviar. Intenta de nuevo en un momento.", tipo: "error" });
    } finally {
      setReenviando(false);
    }
  }

  return (
    <section className="vista activa">
      <div className="icono-grande">
        <i className="ti ti-mail-check" aria-hidden="true" />
      </div>
      <h1>Revisa tu correo</h1>
      <p className="subtitulo">
        Si <strong id="correo-enviado">{correo}</strong> está registrado en EntreLazados, te llegará un enlace para crear tu nueva contraseña.
      </p>

      <div className="consejos">
        <strong>¿No te llega?</strong>
        <ul>
          <li>Puede tardar unos minutos.</li>
          <li>
            Revisa las carpetas de <em>Spam</em> o <em>Promociones</em>.
          </li>
          <li>El enlace vence en 1 hora y solo sirve una vez.</li>
        </ul>
      </div>

      <CajaMensaje id="mensaje-enviado" mensaje={mensaje} rol="status" />

      <a href="/login" className="boton">
        <i className="ti ti-login" aria-hidden="true" /> Ir a iniciar sesión
      </a>
      <div className="enlaces">
        <button type="button" className="enlace-boton" id="btn-reenviar" disabled={reenviando || restantes > 0} onClick={reenviar}>
          {reenviando ? "Reenviando..." : restantes > 0 ? `Reenviar correo (${restantes} s)` : "Reenviar correo"}
        </button>
        <button type="button" className="enlace-boton" id="btn-otro-correo" onClick={otroCorreo}>
          Usar otro correo
        </button>
      </div>
    </section>
  );
}

/* ---------- Paso 3: nueva contraseña ---------- */
const NIVELES: [string, string][] = [
  ["Seguridad de la contraseña", "#eadfd8"],
  ["Débil", "#a12a1a"],
  ["Aceptable", "#c98500"],
  ["Buena", "#2f7d3a"],
  ["Muy segura", "#1e6b2a"],
];

function evaluarFuerza(pass: string) {
  let puntos = 0;
  if (pass.length >= 6) puntos++;
  if (pass.length >= 10) puntos++;
  if (/[a-zA-ZñÑ]/.test(pass) && /\d/.test(pass)) puntos++;
  if (/[^a-zA-Z0-9ñÑ]/.test(pass) || (/[a-z]/.test(pass) && /[A-Z]/.test(pass))) puntos++;
  if (pass.length < 6) puntos = Math.min(puntos, 1);
  return puntos;
}

function Requisito({ id, cumple, texto }: { id: string; cumple: boolean; texto: string }) {
  return (
    <li id={id} className={cumple ? "cumple" : undefined}>
      <i className={cumple ? "ti ti-circle-check" : "ti ti-circle"} aria-hidden="true" /> {texto}
    </li>
  );
}

function CampoClave({
  id,
  valor,
  cambiar,
  referencia,
  ...resto
}: {
  id: string;
  valor: string;
  cambiar: (v: string) => void;
  referencia?: React.Ref<HTMLInputElement>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="campo con-ojo">
      <input
        ref={referencia}
        type={visible ? "text" : "password"}
        id={id}
        autoComplete="new-password"
        maxLength={72}
        required
        value={valor}
        onChange={(e) => cambiar(e.target.value)}
        {...resto}
      />
      <button type="button" className="ver-pass" aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setVisible((v) => !v)}>
        <i className={`ti ti-eye${visible ? "-off" : ""}`} aria-hidden="true" />
      </button>
    </div>
  );
}

function NuevaContrasena({
  token,
  correoCuenta,
  mensaje,
  setMensaje,
  alGuardar,
  invalido,
}: {
  token: string;
  correoCuenta: string;
  mensaje: Mensaje;
  setMensaje: (m: Mensaje) => void;
  alGuardar: () => Promise<void>;
  invalido: () => void;
}) {
  const [pass, setPass] = useState("");
  const [conf, setConf] = useState("");
  const [guardando, setGuardando] = useState(false);
  const campoNueva = useRef<HTMLInputElement>(null);
  const campoConf = useRef<HTMLInputElement>(null);

  useEffect(() => campoNueva.current?.focus(), []);

  const puntos = pass ? evaluarFuerza(pass) : 0;
  const mezcla = /[a-zA-ZñÑ]/.test(pass) && /\d/.test(pass);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pass.length < 6) {
      campoNueva.current?.focus();
      return setMensaje({ texto: "La contraseña debe tener al menos 6 caracteres.", tipo: "error" });
    }
    if (pass !== conf) {
      campoConf.current?.focus();
      return setMensaje({ texto: "Las contraseñas no coinciden.", tipo: "error" });
    }
    setMensaje(null);
    setGuardando(true);
    try {
      const res = await fetch("/api/restablecer-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, nuevaContrasena: pass }),
      });
      const data = await leerJSON<{ message?: string }>(res);
      if (res.ok) return await alGuardar();
      if (/inválido|expirado/i.test(data.message || "")) return invalido();
      setMensaje({ texto: data.message || "No se pudo cambiar la contraseña. Intenta de nuevo.", tipo: "error" });
    } catch {
      setMensaje({ texto: "No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.", tipo: "error" });
    }
    setGuardando(false);
  }

  return (
    <section className="vista activa">
      <h1>Crea tu nueva contraseña</h1>
      <p className="subtitulo" id="texto-cuenta">
        {correoCuenta ? (
          <>
            Cuenta: <strong>{correoCuenta}</strong>. Elige una contraseña que no hayas usado antes.
          </>
        ) : (
          "Elige una contraseña que no hayas usado antes."
        )}
      </p>

      <CajaMensaje id="mensaje-nueva" mensaje={mensaje} rol="alert" />

      <form id="form-nueva" noValidate onSubmit={guardar}>
        <label htmlFor="nuevaPass">Nueva contraseña</label>
        <CampoClave id="nuevaPass" valor={pass} cambiar={setPass} referencia={campoNueva} aria-describedby="fuerza-texto" />
        <div className="fuerza">
          <div className="fuerza-barra">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} style={{ background: i < puntos ? NIVELES[puntos][1] : "#eadfd8" }} />
            ))}
          </div>
          <div className="fuerza-texto" id="fuerza-texto">
            {pass ? "Seguridad: " + NIVELES[puntos][0] : NIVELES[0][0]}
          </div>
        </div>
        <ul className="requisitos">
          <Requisito id="req-largo" cumple={pass.length >= 6} texto="Al menos 6 caracteres" />
          <Requisito id="req-mezcla" cumple={mezcla} texto="Letras y números (recomendado)" />
        </ul>

        <label htmlFor="confirmarPass">Confirmar contraseña</label>
        <CampoClave id="confirmarPass" valor={conf} cambiar={setConf} referencia={campoConf} aria-invalid={conf ? pass !== conf : undefined} />
        <ul className="requisitos">
          <Requisito id="req-igual" cumple={conf.length > 0 && pass === conf} texto="Las dos contraseñas coinciden" />
        </ul>

        <button type="submit" className="boton" id="btn-guardar" disabled={guardando}>
          {guardando ? (
            <Ocupado texto="Guardando..." />
          ) : (
            <>
              <i className="ti ti-lock-check" aria-hidden="true" /> Guardar nueva contraseña
            </>
          )}
        </button>
      </form>

      <Volver />
    </section>
  );
}

/* ---------- Paso 4: listo ---------- */
function Listo() {
  const [segundos, setSegundos] = useState(5);
  const router = useRouter();
  useEffect(() => {
    if (segundos <= 0) {
      router.push("/login");
      return;
    }
    const reloj = setTimeout(() => setSegundos((s) => s - 1), 1000);
    return () => clearTimeout(reloj);
  }, [segundos, router]);

  return (
    <section className="vista activa">
      <div className="icono-grande exito">
        <i className="ti ti-circle-check" aria-hidden="true" />
      </div>
      <h1>¡Contraseña actualizada!</h1>
      <p className="subtitulo">
        Ya puedes entrar a EntreLazados con tu nueva contraseña. Te llevaremos al inicio de sesión en{" "}
        <strong id="cuenta-regresiva">{Math.max(segundos, 0)}</strong> segundos.
      </p>
      <a href="/login" className="boton">
        <i className="ti ti-login" aria-hidden="true" /> Iniciar sesión ahora
      </a>
    </section>
  );
}
