// /perfil: mi perfil (antes perfil.html, ROADMAP 2.3). Se arma en el servidor con
// los datos de la cookie: sin "Cargando..." ni parpadeo.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Buscador from "@/componentes/sitio/Buscador";
import Cabecera from "@/componentes/sitio/Cabecera";
import EnlaceAdmin from "@/componentes/sitio/EnlaceAdmin";
import GlobitoChat from "@/componentes/sitio/GlobitoChat";
import PiePagina from "@/componentes/sitio/PiePagina";
import comun from "@/app/estilos/comun.module.css";
import { DEPARTAMENTOS, ubicarDepartamento } from "@/lib/departamentos";
import { datosDeSesionDesdeCookies } from "@/lib/sesion";
import { perfilCompleto } from "@/lib/usuarios";
import EditarPerfil, { type DatosEditables } from "./_componentes/EditarPerfil";
import estilos from "./perfil.module.css";

export const metadata: Metadata = { title: "Mi Perfil" };

function Dato({ icono, etiqueta, valor, ancho }: { icono: string; etiqueta: string; valor: string; ancho?: boolean }) {
  return (
    <div className="info-box" style={ancho ? { gridColumn: "1 / -1" } : undefined}>
      <div className="info-label">
        <i className={`ti ${icono}`} aria-hidden="true" /> {etiqueta}
      </div>
      <div className="info-value">{valor}</div>
    </div>
  );
}

export default async function PaginaPerfil() {
  const sesion = await datosDeSesionDesdeCookies();
  if (!sesion) redirect("/login");
  const data = await perfilCompleto(sesion.id);
  if (!data) redirect("/login");

  const rol = (data.TipoRol || "").toLowerCase().trim();
  const esAdmin = rol === "administrador" || rol === "admin";
  const departamento = data.NombreDepartamento || "Managua";
  const icono = esAdmin ? "ti-shield-check" : rol === "proveedor" ? "ti-truck" : "ti-shoe";

  // Lo que el formulario de "Editar perfil" muestra ya lleno
  const editables: DatosEditables = {
    id: data.UsuarioID,
    rol: esAdmin ? "admin" : rol === "proveedor" ? "proveedor" : "emprendedor",
    correo: data.CorreoElectronico || "",
    nombre: data.NombreRazonSocial || "",
    telefono: data.TelefonoWhatsApp || "",
    departamento: ubicarDepartamento(data.NombreDepartamento)?.nombre ?? "",
    numeroRuc: data.NumeroRUC || "",
    nombreComercial: data.NombreComercial || "",
    tipoMateriaPrimaPrincipal: data.TipoMateriaPrimaPrincipal || "",
    descripcionEmpresa: data.DescripcionEmpresa || "",
    nombreMarca: data.NombreMarca || "",
    especialidadCalzado: data.EspecialidadCalzado || "",
    capacidadProduccionMensual: data.CapacidadProduccionMensual == null ? "" : String(data.CapacidadProduccionMensual),
  };

  return (
    <div className={`${comun.pagina} ${estilos.pagina}`}>
      <div id="app" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <Cabecera>
          <Buscador />
        </Cabecera>

        <nav className="sub-bar" aria-label="Secciones">
          <Link href="/inicio">
            <i className="ti ti-home" aria-hidden="true" /> Inicio
          </Link>
          <Link href="/mercado">
            <i className="ti ti-building-store" aria-hidden="true" /> Mercado Completo
          </Link>
          <Link href="/chat">
            <i className="ti ti-message-circle" aria-hidden="true" /> Chat
            <GlobitoChat />
          </Link>
          <Link href="/dashboard">
            <i className="ti ti-chart-bar" aria-hidden="true" /> Dashboard
          </Link>
          <EnlaceAdmin />
        </nav>

        {/* TARJETA DE PERFIL */}
        <main className="profile-container" id="contenido-principal" tabIndex={-1}>
          <div className="profile-card">
            <div className="profile-header-banner" />
            <div className="profile-avatar-wrapper">
              <div className="profile-avatar">
                <i className={`ti ${icono}`} id="avatar-icon" aria-hidden="true" />
              </div>
              <div className="profile-header-info">
                <h2 id="profile-nombre">{data.NombreRazonSocial || "Sin Nombre"}</h2>
                <span className={`role-badge${esAdmin ? " admin-badge" : ""}`} id="profile-rol-badge">
                  {(data.TipoRol || "Miembro").toUpperCase()}
                </span>
                {/* Proveedores y emprendedores tienen un perfil público que se puede compartir */}
                {!esAdmin && (
                  <Link href={`/perfil-publico?id=${data.UsuarioID}`} id="enlace-perfil-publico" className="enlace-publico">
                    <i className="ti ti-eye" aria-hidden="true" /> Ver mi perfil público
                  </Link>
                )}
              </div>
            </div>

            <div className="profile-body">
              <EditarPerfil datos={editables} departamentos={DEPARTAMENTOS.map((d) => d.nombre)}>
                <div className="section-header">
                  <i className="ti ti-user-check" aria-hidden="true" /> Información General
                </div>
                <div className="info-grid">
                  <Dato icono="ti-id-badge" etiqueta="Nombre / Razón Social" valor={data.NombreRazonSocial || "N/A"} />
                  <Dato icono="ti-mail" etiqueta="Correo Electrónico" valor={data.CorreoElectronico || "N/A"} />
                  <Dato
                    icono="ti-brand-whatsapp"
                    etiqueta="Teléfono / WhatsApp"
                    valor={data.TelefonoWhatsApp || "No especificado"}
                  />
                  <Dato icono="ti-map-pin" etiqueta="Departamento" valor={departamento} />
                </div>

                {rol === "proveedor" && (
                  <div id="section-proveedor">
                    <div className="section-header">
                      <i className="ti ti-truck-delivery" aria-hidden="true" /> Detalle de Proveedor
                    </div>
                    <div className="info-grid">
                      <Dato icono="ti-file-text" etiqueta="Número RUC" valor={data.NumeroRUC || "No registrado"} />
                      <Dato icono="ti-building-store" etiqueta="Nombre Comercial" valor={data.NombreComercial || "N/A"} />
                      <Dato
                        icono="ti-box"
                        etiqueta="Materia Prima Principal"
                        valor={data.TipoMateriaPrimaPrincipal || "No especificado"}
                      />
                      <Dato
                        icono="ti-info-circle"
                        etiqueta="Descripción de la Empresa"
                        valor={data.DescripcionEmpresa || "Sin descripción disponible."}
                        ancho
                      />
                    </div>
                  </div>
                )}

                {rol === "emprendedor" && (
                  <div id="section-emprendedor">
                    <div className="section-header">
                      <i className="ti ti-shoe" aria-hidden="true" /> Detalle del Taller / Emprendimiento
                    </div>
                    <div className="info-grid">
                      <Dato icono="ti-tag" etiqueta="Nombre de la Marca" valor={data.NombreMarca || "N/A"} />
                      <Dato
                        icono="ti-shoe"
                        etiqueta="Especialidad de Calzado"
                        valor={data.EspecialidadCalzado || "No especificado"}
                      />
                      <Dato
                        icono="ti-chart-bar"
                        etiqueta="Capacidad Mensual"
                        valor={
                          data.CapacidadProduccionMensual ? `${data.CapacidadProduccionMensual} pares/mes` : "No especificada"
                        }
                      />
                    </div>
                  </div>
                )}

                {esAdmin && (
                  <div id="section-admin">
                    <div className="section-header">
                      <i className="ti ti-shield-check" aria-hidden="true" /> Panel de Control Administrativo
                    </div>
                    <p style={{ fontSize: 13, color: "#666", marginBottom: 15 }}>
                      Cuentas con permisos de administración general para moderar la plataforma, gestionar cuentas de usuarios y
                      supervisar transacciones.
                    </p>
                    <div className="admin-actions-grid">
                      <Link href="/admin" className="btn-admin-action">
                        <i className="ti ti-layout-dashboard" style={{ fontSize: 20 }} aria-hidden="true" />
                        Panel General Admin
                      </Link>
                      <Link href="/mercado" className="btn-admin-action">
                        <i className="ti ti-shield-x" style={{ fontSize: 20 }} aria-hidden="true" />
                        Moderar Publicaciones
                      </Link>
                      <Link href="/chat" className="btn-admin-action">
                        <i className="ti ti-headset" style={{ fontSize: 20 }} aria-hidden="true" />
                        Canal de Soporte
                      </Link>
                    </div>
                  </div>
                )}
              </EditarPerfil>
            </div>
          </div>
        </main>

        <PiePagina
          enlaces={[
            ["/inicio", "Inicio"],
            ["/mercado", "Mercado"],
            ["/chat", "Chat"],
            ["/perfil", "Mi Perfil"],
          ]}
        />
      </div>
    </div>
  );
}
