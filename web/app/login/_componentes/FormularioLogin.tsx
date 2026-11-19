"use client";
// Formulario de inicio de sesión. Misma lógica que la vieja login.html:
// - si la cookie de sesión todavía sirve (GET /api/sesion), va directo al inicio según el
//   rol; si ya no sirve, se borra lo guardado en el navegador;
// - POST /api/login deja la sesión en la cookie httpOnly y aquí se guardan los datos que
//   no son secretos (lib/cliente/sesion.ts);
// - cuenta sin confirmar: ofrece reenviar el enlace.
import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cerrarSesion,
  type DatosLogin,
  guardarSesion,
  inicioSegunRol,
  leerJSON,
  REGEX_EMAIL,
  sesionGuardada,
} from "@/lib/cliente/sesion";

// Al cambiar de sesión se navega completo (no con el router del cliente): así ninguna
// página guardada de cuando no había sesión (que manda a /login) se reutiliza.
function irAlInicio(rol: string, reemplazar = false) {
  const destino = new URL(inicioSegunRol(rol), window.location.origin).href;
  if (reemplazar) window.location.replace(destino);
  else window.location.assign(destino);
}

export default function FormularioLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  // GUARDIÁN: con sesión activa no tiene sentido mostrar el login. Se pregunta al servidor
  // (no basta lo guardado: la cookie pudo vencer y /inicio devolvería aquí otra vez)
  useEffect(() => {
    if (!sesionGuardada()) return;
    let vivo = true;
    fetch("/api/sesion")
      .then(async (res) => {
        if (!vivo) return;
        if (res.ok) irAlInicio(((await res.json()) as { rol: string }).rol, true);
        else await cerrarSesion();
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  async function procesarLogin(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const correo = email.trim();
    const clave = password.trim();
    if (!correo || !REGEX_EMAIL.test(correo)) {
      alert("Por favor, ingresa un correo electrónico válido con su dominio completo (ejemplo: usuario@gmail.com).");
      return;
    }
    if (!clave) {
      alert("Por favor, ingresa tu contraseña.");
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: correo, password: clave }),
      });
      const data = await leerJSON<DatosLogin & { message?: string; verificacionPendiente?: boolean }>(res);

      if (res.ok) {
        guardarSesion(correo, data);
        alert(`¡Bienvenido de vuelta, ${data.nombre}!`);
        irAlInicio(data.rol);
        return;
      }
      if (data.verificacionPendiente) {
        // Cuenta nueva que todavía no confirmó su correo: se ofrece reenviar el enlace
        if (confirm(`${data.message}\n\n¿Quieres que te enviemos un enlace nuevo a ${correo}?`)) {
          const reenvio = await fetch("/api/reenviar-verificacion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: correo }),
          });
          const datosReenvio = await leerJSON<{ message?: string }>(reenvio);
          alert(datosReenvio.message || "Listo. Revisa tu correo.");
        }
        return;
      }
      alert(data.message || "Correo o contraseña incorrectos.");
    } catch {
      alert("Error al conectar con el servidor.");
    } finally {
      setEnviando(false);
    }
  }

  // Lleva a la página de recuperación, con el correo ya escrito si el usuario lo puso
  function solicitarRecuperacion(evento: React.MouseEvent) {
    evento.preventDefault();
    const correo = email.trim();
    router.push("/restablecer" + (REGEX_EMAIL.test(correo) ? "?email=" + encodeURIComponent(correo) : ""));
  }

  return (
    <form id="loginForm" onSubmit={procesarLogin}>
      <div className="form-group">
        <label htmlFor="login-email">Correo Electrónico</label>
        <div className="input-wrapper">
          <i className="ti ti-mail" aria-hidden="true" />
          <input
            type="email"
            id="login-email"
            className="form-control"
            placeholder="ejemplo@correo.com"
            pattern="^[^\s@]+@[^\s@]+\.[^\s@]{2,}$"
            title="Ingresa un correo válido con su dominio completo (ejemplo: usuario@gmail.com)"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="login-password">Contraseña</label>
        <div className="input-wrapper">
          <i className="ti ti-lock" aria-hidden="true" />
          <input
            type="password"
            id="login-password"
            className="form-control"
            placeholder="••••••••"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <a href="/restablecer" onClick={solicitarRecuperacion} className="forgot-link">
          ¿Olvidaste tu contraseña?
        </a>
      </div>

      <button type="submit" id="btn-submit-login" className="btn-primary" disabled={enviando}>
        {enviando ? (
          <>
            <i className="ti ti-loader" aria-hidden="true" /> Verificando...
          </>
        ) : (
          <>
            <i className="ti ti-login" aria-hidden="true" /> Entrar a la Plataforma
          </>
        )}
      </button>
    </form>
  );
}
