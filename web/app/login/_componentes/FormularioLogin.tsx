"use client";
// Formulario de inicio de sesión. Misma lógica que la vieja login.html:
// - si ya hay sesión en este navegador, va directo al inicio según el rol;
// - POST /api/login deja la sesión en la cookie httpOnly y aquí se guardan los
//   datos que usan las páginas viejas (lib/cliente/sesion.ts);
// - cuenta sin confirmar: ofrece reenviar el enlace.
import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { type DatosLogin, guardarSesion, inicioSegunRol, leerJSON, REGEX_EMAIL, sesionGuardada } from "@/lib/cliente/sesion";

export default function FormularioLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  // GUARDIÁN: con sesión activa no tiene sentido mostrar el login
  useEffect(() => {
    const sesion = sesionGuardada();
    if (sesion) window.location.href = inicioSegunRol(sesion.rol);
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
        window.location.href = inicioSegunRol(data.rol);
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
