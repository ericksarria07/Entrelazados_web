"use client";
// Formulario de registro. Misma lógica que la vieja unirse.html: se elige el perfil
// (Proveedor o Emprendedor), cambian los campos de abajo y se envía a POST /registro.
import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { leerJSON, REGEX_EMAIL } from "@/lib/cliente/sesion";

type Rol = "Proveedor" | "Emprendedor";

const CAMPOS_INICIALES = {
  nombreNegocio: "",
  correo: "",
  telefono: "",
  deptoId: "",
  numeroRuc: "",
  nombreComercial: "",
  tipoMateriaPrimaPrincipal: "",
  descripcionEmpresa: "",
  nombreMarca: "",
  especialidadCalzado: "",
  capacidadProduccionMensual: "",
  password: "",
  confirmPassword: "",
};
type Campos = typeof CAMPOS_INICIALES;

// Campo con ícono a la izquierda, como en la página vieja
function Campo({
  id,
  etiqueta,
  icono,
  valor,
  cambiar,
  tipo = "text",
  ...resto
}: {
  id: keyof Campos;
  etiqueta: string;
  icono: string;
  valor: string;
  cambiar: (id: keyof Campos, valor: string) => void;
  tipo?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "type">) {
  return (
    <div className="form-group">
      <label htmlFor={id}>{etiqueta}</label>
      <div className="input-wrapper">
        <i className={`ti ${icono}`} aria-hidden="true" />
        <input type={tipo} id={id} className="form-control" value={valor} onChange={(e) => cambiar(id, e.target.value)} {...resto} />
      </div>
    </div>
  );
}

export default function FormularioRegistro() {
  const [rol, setRol] = useState<Rol>("Proveedor");
  const [c, setC] = useState<Campos>(CAMPOS_INICIALES);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();
  const cambiar = (id: keyof Campos, valor: string) => setC((antes) => ({ ...antes, [id]: valor }));

  async function enviarDatos(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const nombre = c.nombreNegocio.trim();
    const email = c.correo.trim();
    const telefono = c.telefono.trim();
    const deptoId = c.deptoId.trim();

    if (!nombre || !email || !telefono || !deptoId || !c.password || !c.confirmPassword) {
      alert("Por favor, rellena todos los campos obligatorios antes de continuar.");
      return;
    }
    if (!REGEX_EMAIL.test(email)) {
      alert("Por favor, ingresa un correo electrónico válido con su dominio completo (ejemplo: usuario@gmail.com).");
      return;
    }
    if (c.password.length < 8) {
      alert("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (c.password !== c.confirmPassword) {
      alert("Las contraseñas no coinciden. Por favor verifícalas.");
      return;
    }

    const datos = {
      nombre,
      rol,
      email,
      telefono,
      deptoId,
      password: c.password,
      numeroRuc: c.numeroRuc.trim(),
      nombreComercial: c.nombreComercial.trim(),
      tipoMateriaPrimaPrincipal: c.tipoMateriaPrimaPrincipal.trim(),
      descripcionEmpresa: c.descripcionEmpresa.trim(),
      nombreMarca: c.nombreMarca.trim(),
      especialidadCalzado: c.especialidadCalzado.trim(),
      capacidadProduccionMensual: c.capacidadProduccionMensual.trim(),
    };

    setEnviando(true);
    try {
      const res = await fetch("/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
      const resultado = await leerJSON<{ message?: string }>(res);
      if (res.ok) {
        alert("¡Éxito! " + (resultado.message || "Registro completado exitosamente."));
        router.push("/login");
      } else {
        alert("Error del servidor: " + (resultado.message || "No se pudo registrar."));
      }
    } catch {
      alert("No se pudo conectar al servidor. Intenta de nuevo en unos minutos.");
    } finally {
      setEnviando(false);
    }
  }

  const opcion = (valor: Rol, id: string, icono: string) => (
    <button
      type="button"
      className={`role-option${rol === valor ? " selected" : ""}`}
      id={id}
      aria-pressed={rol === valor}
      onClick={() => setRol(valor)}
    >
      <i className={`ti ${icono}`} aria-hidden="true" />
      <div className="role-name">{valor}</div>
    </button>
  );

  return (
    <>
      <div className="role-selector">
        {opcion("Proveedor", "optProveedor", "ti-truck-delivery")}
        {opcion("Emprendedor", "optEmprendedor", "ti-shoe")}
      </div>

      <form id="registerForm" onSubmit={enviarDatos}>
        <Campo id="nombreNegocio" etiqueta="Nombre o Razón Social" icono="ti-building-store" valor={c.nombreNegocio} cambiar={cambiar} placeholder="Ej. Taller Jiménez" required />
        <Campo
          id="correo"
          etiqueta="Correo Electrónico"
          icono="ti-mail"
          tipo="email"
          valor={c.correo}
          cambiar={cambiar}
          placeholder="contacto@taller.com"
          pattern="^[^\s@]+@[^\s@]+\.[^\s@]{2,}$"
          title="Ingresa un correo electrónico válido con su dominio completo (ejemplo: usuario@gmail.com)"
          autoComplete="email"
          required
        />
        <Campo id="telefono" etiqueta="Teléfono WhatsApp" icono="ti-brand-whatsapp" valor={c.telefono} cambiar={cambiar} placeholder="Ej. +505 8888-8888" autoComplete="tel" required />
        <Campo id="deptoId" etiqueta="Departamento" icono="ti-map-pin" valor={c.deptoId} cambiar={cambiar} placeholder="Ej. Managua, Masaya, León..." required />

        {rol === "Proveedor" ? (
          <div id="seccionProveedor" className="dynamic-section">
            <h3>
              <i className="ti ti-box" aria-hidden="true" /> Datos del Proveedor
            </h3>
            <Campo id="numeroRuc" etiqueta="Número RUC" icono="ti-id" valor={c.numeroRuc} cambiar={cambiar} placeholder="Ej. J0310000000000" />
            <Campo id="nombreComercial" etiqueta="Nombre Comercial" icono="ti-briefcase" valor={c.nombreComercial} cambiar={cambiar} placeholder="Ej. Cueros e Insumos Nicaragua" />
            <Campo
              id="tipoMateriaPrimaPrincipal"
              etiqueta="Materia Prima Principal"
              icono="ti-packages"
              valor={c.tipoMateriaPrimaPrincipal}
              cambiar={cambiar}
              placeholder="Ej. Cuero vacuno, Suelas, Sillas, Herrajes"
            />
            <div className="form-group">
              <label htmlFor="descripcionEmpresa">Descripción de la Empresa</label>
              <div className="input-wrapper">
                <i className="ti ti-notes" aria-hidden="true" />
                <textarea
                  id="descripcionEmpresa"
                  className="form-control"
                  placeholder="Breve descripción de los insumos o servicios que ofreces..."
                  value={c.descripcionEmpresa}
                  onChange={(e) => cambiar("descripcionEmpresa", e.target.value)}
                />
              </div>
            </div>
          </div>
        ) : (
          <div id="seccionEmprendedor" className="dynamic-section">
            <h3>
              <i className="ti ti-cut" aria-hidden="true" /> Datos del Emprendedor
            </h3>
            <Campo id="nombreMarca" etiqueta="Nombre de la Marca" icono="ti-tag" valor={c.nombreMarca} cambiar={cambiar} placeholder="Ej. Calzados Artesanales M&R" />
            <Campo
              id="especialidadCalzado"
              etiqueta="Especialidad en Calzado"
              icono="ti-shoe"
              valor={c.especialidadCalzado}
              cambiar={cambiar}
              placeholder="Ej. Botas de cuero, Sandalias, Calzado formal"
            />
            <Campo
              id="capacidadProduccionMensual"
              etiqueta="Capacidad de Producción Mensual (Pares)"
              icono="ti-report-analytics"
              tipo="number"
              valor={c.capacidadProduccionMensual}
              cambiar={cambiar}
              placeholder="Ej. 250"
            />
          </div>
        )}

        <Campo id="password" etiqueta="Crear Contraseña" icono="ti-lock" tipo="password" valor={c.password} cambiar={cambiar} placeholder="••••••••" autoComplete="new-password" required />
        <Campo
          id="confirmPassword"
          etiqueta="Confirmar Contraseña"
          icono="ti-lock-check"
          tipo="password"
          valor={c.confirmPassword}
          cambiar={cambiar}
          placeholder="••••••••"
          autoComplete="new-password"
          required
        />

        <button type="submit" className="btn-primary" disabled={enviando}>
          <i className="ti ti-user-plus" aria-hidden="true" /> Completar Registro
        </button>
      </form>
    </>
  );
}
