"use client";
// Editar mi perfil: el botón cambia la vista de lectura (children, armada en el servidor)
// por un formulario con los datos actuales. Al guardar, router.refresh() vuelve a armar la
// página y la cabecera en el servidor, así el nombre nuevo aparece sin recargar.
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { apiJSON, conJSON } from "@/lib/cliente/api";

export type DatosEditables = {
  id: number;
  rol: "proveedor" | "emprendedor" | "admin";
  correo: string;
  nombre: string;
  telefono: string;
  departamento: string;
  numeroRuc: string;
  nombreComercial: string;
  tipoMateriaPrimaPrincipal: string;
  descripcionEmpresa: string;
  nombreMarca: string;
  especialidadCalzado: string;
  capacidadProduccionMensual: string;
};

type Campos = Omit<DatosEditables, "id" | "rol" | "correo">;

function Campo({
  id,
  etiqueta,
  icono,
  valor,
  cambiar,
  ...resto
}: {
  id: keyof Campos;
  etiqueta: string;
  icono: string;
  valor: string;
  cambiar: (id: keyof Campos, valor: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange">) {
  return (
    <label className="campo-perfil" htmlFor={`perfil-${id}`}>
      <span className="info-label">
        <i className={`ti ${icono}`} aria-hidden="true" /> {etiqueta}
      </span>
      <input id={`perfil-${id}`} value={valor} onChange={(e) => cambiar(id, e.target.value)} {...resto} />
    </label>
  );
}

export default function EditarPerfil({
  datos,
  departamentos,
  children,
}: {
  datos: DatosEditables;
  departamentos: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  // Los campos que se editan (id, rol y correo no)
  const inicial = (): Campos => ({
    nombre: datos.nombre,
    telefono: datos.telefono,
    departamento: datos.departamento,
    numeroRuc: datos.numeroRuc,
    nombreComercial: datos.nombreComercial,
    tipoMateriaPrimaPrincipal: datos.tipoMateriaPrimaPrincipal,
    descripcionEmpresa: datos.descripcionEmpresa,
    nombreMarca: datos.nombreMarca,
    especialidadCalzado: datos.especialidadCalzado,
    capacidadProduccionMensual: datos.capacidadProduccionMensual,
  });
  const [c, setC] = useState<Campos>(inicial);
  const cambiar = (id: keyof Campos, valor: string) => setC((antes) => ({ ...antes, [id]: valor }));

  function abrir() {
    setC(inicial());
    setError("");
    setAviso("");
    setEditando(true);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError("");
    setGuardando(true);
    try {
      await apiJSON(`/api/perfil/${datos.id}`, conJSON("PUT", c));
      setEditando(false);
      setAviso("Tus datos se guardaron.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  if (!editando) {
    return (
      <>
        <div className="perfil-acciones">
          {aviso && (
            <p className="perfil-aviso" role="status">
              <i className="ti ti-circle-check" aria-hidden="true" /> {aviso}
            </p>
          )}
          <button type="button" className="btn-perfil" id="btn-editar-perfil" onClick={abrir}>
            <i className="ti ti-pencil" aria-hidden="true" /> Editar perfil
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <form id="form-perfil" className="form-perfil" onSubmit={guardar} noValidate>
      <div className="section-header">
        <i className="ti ti-user-edit" aria-hidden="true" /> Información General
      </div>
      <div className="info-grid">
        <Campo
          id="nombre"
          etiqueta="Nombre / Razón Social"
          icono="ti-id-badge"
          valor={c.nombre}
          cambiar={cambiar}
          maxLength={150}
          required
          autoComplete="name"
        />
        <label className="campo-perfil" htmlFor="perfil-correo">
          <span className="info-label">
            <i className="ti ti-mail" aria-hidden="true" /> Correo Electrónico
          </span>
          <input id="perfil-correo" value={datos.correo} disabled aria-describedby="perfil-correo-nota" />
          <small id="perfil-correo-nota" className="nota-campo">
            El correo no se cambia desde aquí.
          </small>
        </label>
        <Campo
          id="telefono"
          etiqueta="Teléfono / WhatsApp"
          icono="ti-brand-whatsapp"
          valor={c.telefono}
          cambiar={cambiar}
          maxLength={20}
          required
          type="tel"
          autoComplete="tel"
          placeholder="Ej. +505 8888-8888"
        />
        <label className="campo-perfil" htmlFor="perfil-departamento">
          <span className="info-label">
            <i className="ti ti-map-pin" aria-hidden="true" /> Departamento
          </span>
          <select
            id="perfil-departamento"
            value={c.departamento}
            onChange={(e) => cambiar("departamento", e.target.value)}
            required
          >
            {!c.departamento && <option value="">Elige tu departamento</option>}
            {departamentos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      {datos.rol === "proveedor" && (
        <>
          <div className="section-header">
            <i className="ti ti-truck-delivery" aria-hidden="true" /> Detalle de Proveedor
          </div>
          <div className="info-grid">
            <Campo
              id="numeroRuc"
              etiqueta="Número RUC"
              icono="ti-file-text"
              valor={c.numeroRuc}
              cambiar={cambiar}
              maxLength={50}
            />
            <Campo
              id="nombreComercial"
              etiqueta="Nombre Comercial"
              icono="ti-building-store"
              valor={c.nombreComercial}
              cambiar={cambiar}
              maxLength={150}
            />
            <Campo
              id="tipoMateriaPrimaPrincipal"
              etiqueta="Materia Prima Principal"
              icono="ti-box"
              valor={c.tipoMateriaPrimaPrincipal}
              cambiar={cambiar}
              maxLength={100}
            />
            <label className="campo-perfil campo-ancho" htmlFor="perfil-descripcionEmpresa">
              <span className="info-label">
                <i className="ti ti-info-circle" aria-hidden="true" /> Descripción de la Empresa
              </span>
              <textarea
                id="perfil-descripcionEmpresa"
                rows={4}
                maxLength={2000}
                value={c.descripcionEmpresa}
                onChange={(e) => cambiar("descripcionEmpresa", e.target.value)}
              />
            </label>
          </div>
        </>
      )}

      {datos.rol === "emprendedor" && (
        <>
          <div className="section-header">
            <i className="ti ti-shoe" aria-hidden="true" /> Detalle del Taller / Emprendimiento
          </div>
          <div className="info-grid">
            <Campo
              id="nombreMarca"
              etiqueta="Nombre de la Marca"
              icono="ti-tag"
              valor={c.nombreMarca}
              cambiar={cambiar}
              maxLength={150}
            />
            <Campo
              id="especialidadCalzado"
              etiqueta="Especialidad de Calzado"
              icono="ti-shoe"
              valor={c.especialidadCalzado}
              cambiar={cambiar}
              maxLength={100}
            />
            <Campo
              id="capacidadProduccionMensual"
              etiqueta="Capacidad Mensual (pares)"
              icono="ti-chart-bar"
              valor={c.capacidadProduccionMensual}
              cambiar={cambiar}
              type="number"
              min={0}
              max={1000000}
              step={1}
              inputMode="numeric"
            />
          </div>
        </>
      )}

      {error && (
        <p className="perfil-error" role="alert">
          <i className="ti ti-alert-circle" aria-hidden="true" /> {error}
        </p>
      )}
      <div className="perfil-acciones">
        <button type="button" className="btn-perfil btn-secundario" onClick={() => setEditando(false)} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="btn-perfil" id="btn-guardar-perfil" disabled={guardando}>
          <i className="ti ti-device-floppy" aria-hidden="true" /> {guardando ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}
