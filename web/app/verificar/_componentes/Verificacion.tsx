"use client";
// Confirma el correo con el token del enlace (/verificar?token=...) y, si el enlace no
// sirve, deja pedir uno nuevo. Misma lógica que la vieja verificar.html.
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REGEX_TOKEN = /^[a-f0-9]{64}$/i;
const ERROR_POR_DEFECTO =
  "El enlace no es válido o ya venció (dura 24 horas). Pide uno nuevo con el correo con el que te registraste.";

type Vista = "cargando" | "exito" | "error";
type Aviso = { tipo: "exito" | "error"; texto: string } | null;

export function Cargando() {
  return (
    <section aria-live="polite">
      <p className="cargando">
        <i className="ti ti-loader-2 giro" aria-hidden="true" /> Confirmando tu correo...
      </p>
    </section>
  );
}

export default function Verificacion() {
  const token = useSearchParams().get("token") ?? "";
  const tokenValido = REGEX_TOKEN.test(token);
  const [vista, setVista] = useState<Vista>(tokenValido ? "cargando" : "error");
  const [textoError, setTextoError] = useState(ERROR_POR_DEFECTO);

  useEffect(() => {
    if (!tokenValido) return;
    let vigente = true;
    (async () => {
      try {
        const res = await fetch("/api/verificar-correo?token=" + encodeURIComponent(token));
        const datos = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (res.ok && datos.ok) {
          // El enlace ya se usó: se quita de la barra de direcciones
          window.history.replaceState(null, "", "/verificar");
          setVista("exito");
          return;
        }
        if (datos.message) setTextoError(datos.message);
      } catch {
        if (vigente) setTextoError("No se pudo conectar con el servidor. Intenta de nuevo en unos minutos.");
      }
      if (vigente) setVista("error");
    })();
    return () => {
      vigente = false;
    };
  }, [token, tokenValido]);

  if (vista === "cargando") return <Cargando />;

  if (vista === "exito") {
    return (
      <section>
        <div className="icono-grande exito">
          <i className="ti ti-mail-check" aria-hidden="true" />
        </div>
        <h1>¡Correo confirmado!</h1>
        <p className="subtitulo">Tu cuenta ya está activa. Ahora puedes iniciar sesión en EntreLazados.</p>
        <Link href="/login" className="boton" id="btn-login">
          <i className="ti ti-login" aria-hidden="true" /> Iniciar sesión
        </Link>
      </section>
    );
  }

  return (
    <section>
      <div className="icono-grande error">
        <i className="ti ti-mail-x" aria-hidden="true" />
      </div>
      <h1>El enlace no sirve</h1>
      <p className="subtitulo" id="texto-error">
        {textoError}
      </p>
      <PedirEnlaceNuevo />
      <div className="enlaces">
        <Link href="/login">
          <i className="ti ti-arrow-left" aria-hidden="true" /> Volver a iniciar sesión
        </Link>
      </div>
    </section>
  );
}

function PedirEnlaceNuevo() {
  const [correo, setCorreo] = useState("");
  const [aviso, setAviso] = useState<Aviso>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const limpio = correo.trim();
    if (!REGEX_EMAIL.test(limpio)) {
      setAviso({ tipo: "error", texto: "Escribe un correo válido con su dominio completo (ejemplo: usuario@gmail.com)." });
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/reenviar-verificacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: limpio }),
      });
      const datos = await res.json().catch(() => ({}));
      setAviso({
        tipo: res.ok ? "exito" : "error",
        texto: datos.message || (res.ok ? "Listo. Revisa tu correo." : "No se pudo enviar el enlace."),
      });
    } catch {
      setAviso({ tipo: "error", texto: "No se pudo conectar con el servidor." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      {aviso && (
        <div id="mensaje-reenvio" className={`mensaje ${aviso.tipo}`} role="status">
          {aviso.texto}
        </div>
      )}
      <form id="form-reenviar" noValidate onSubmit={enviar}>
        <label htmlFor="correo">Correo electrónico</label>
        <input
          type="email"
          id="correo"
          autoComplete="email"
          inputMode="email"
          placeholder="usuario@gmail.com"
          required
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
        />
        <button type="submit" className="boton" id="btn-reenviar" disabled={enviando}>
          <i className="ti ti-mail-forward" aria-hidden="true" /> Enviarme un enlace nuevo
        </button>
      </form>
    </>
  );
}
