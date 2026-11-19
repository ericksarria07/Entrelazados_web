// Métricas, usuarios, moderación de ofertas y categorías del panel de administración
"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, conJSON } from "@/lib/cliente/api";
import { cerrarSesion } from "@/lib/cliente/sesion";
import { olvidarCategorias } from "@/lib/cliente/categorias";

type Pagina<T> = { datos: T[]; total: number; pagina: number; paginas: number };
type Metricas = {
  totalUsuarios?: number;
  totalProveedores?: number;
  totalEmprendedores?: number;
  totalOfertas?: number;
  correosInvalidos?: number;
  cuentasSinVerificar?: number;
};
type UsuarioAdmin = {
  UsuarioID: number;
  NombreRazonSocial: string | null;
  CorreoElectronico: string;
  TipoRol: string | null;
  NombreDepartamento: string | null;
  EstadoCuenta: string | null;
  CorreoValido: boolean;
  CorreoVerificado: boolean;
};
type OfertaAdmin = { OfertaID: number; TituloMaterial: string; NombreCategoria: string | null; Precio: string; UnidadMedida: string };

// La API de admin responde 403 si la cuenta ya no es administradora
async function apiAdmin(url: string, opciones?: RequestInit) {
  const res = await api(url, opciones);
  if (url.includes("/api/admin/") && res.status === 403) {
    await cerrarSesion();
    alert("Esta sección es solo para administradores.");
    window.location.href = "/login";
  }
  return res;
}

async function mensaje(res: Response) {
  try {
    return ((await res.json()) as { message?: string; error?: string }).message ?? "";
  } catch {
    return "";
  }
}

function Paginacion({ datos, ir }: { datos: Pagina<unknown> | null; ir: (p: number) => void }) {
  if (!datos || datos.paginas <= 1) return null;
  return (
    <>
      <button disabled={datos.pagina <= 1} onClick={() => ir(datos.pagina - 1)}>
        <i className="ti ti-chevron-left" aria-hidden="true" /> Anterior
      </button>
      <span>
        Página <strong>{datos.pagina}</strong> de {datos.paginas} · {datos.total} en total
      </span>
      <button disabled={datos.pagina >= datos.paginas} onClick={() => ir(datos.pagina + 1)}>
        Siguiente <i className="ti ti-chevron-right" aria-hidden="true" />
      </button>
    </>
  );
}

const cuentas = (n: number) => `${n} cuenta${n === 1 ? "" : "s"}`;

export default function PanelAdmin() {
  const [metricas, setMetricas] = useState<Metricas>({});
  const [usuarios, setUsuarios] = useState<Pagina<UsuarioAdmin> | null>(null);
  const [ofertas, setOfertas] = useState<Pagina<OfertaAdmin> | null>(null);
  const [buscar, setBuscar] = useState("");
  const [soloProblemas, setSoloProblemas] = useState(false);
  const [catNombre, setCatNombre] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const paginaUsuarios = useRef(1);
  const paginaOfertas = useRef(1);
  const pausa = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 1. MÉTRICAS
  const cargarMetricas = useCallback(async () => {
    try {
      const res = await apiAdmin("/api/admin/metricas");
      if (!res.ok) throw new Error("Error al obtener métricas");
      setMetricas(await res.json());
    } catch (err) {
      console.error("Error métricas:", err);
    }
  }, []);

  // 2. USUARIOS (20 por página, con búsqueda)
  const cargarUsuarios = useCallback(
    async (pagina = paginaUsuarios.current, texto = buscar, problemas = soloProblemas): Promise<void> => {
      paginaUsuarios.current = pagina;
      const params = new URLSearchParams({ pagina: String(pagina), porPagina: "20" });
      if (texto.trim()) params.set("buscar", texto.trim());
      if (problemas) params.set("problemas", "1");
      try {
        const res = await apiAdmin(`/api/admin/usuarios?${params}`);
        const datos = (await res.json()) as Pagina<UsuarioAdmin>;
        if (datos.datos.length === 0 && datos.total > 0 && pagina > 1) return cargarUsuarios(datos.paginas, texto, problemas);
        setUsuarios(datos);
      } catch (err) {
        console.error("Error usuarios:", err);
      }
    },
    [buscar, soloProblemas]
  );

  // 3. OFERTAS (15 por página, las más nuevas primero)
  const cargarOfertas = useCallback(async (pagina = paginaOfertas.current): Promise<void> => {
    paginaOfertas.current = pagina;
    try {
      const res = await api(`/api/ofertas?pagina=${pagina}&porPagina=15`);
      const datos = (await res.json()) as Pagina<OfertaAdmin>;
      if (datos.datos.length === 0 && datos.total > 0 && pagina > 1) return cargarOfertas(datos.paginas);
      setOfertas(datos);
    } catch (err) {
      console.error("Error ofertas:", err);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      cargarMetricas();
      cargarUsuarios(1);
      cargarOfertas(1);
    }, 0);
    return () => clearTimeout(t);
    // Solo al abrir la página
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function alBuscar(texto: string) {
    setBuscar(texto);
    clearTimeout(pausa.current);
    pausa.current = setTimeout(() => cargarUsuarios(1, texto, soloProblemas), 300);
  }

  // Corrige un correo mal escrito (p. ej. "erick@gmail" sin ".com"): confírmalo antes con la persona
  async function corregirCorreo(id: number, actual: string) {
    const correo = prompt(
      `Correo nuevo para el usuario #${id}.\nConfírmalo antes con la persona: con él iniciará sesión y recuperará su contraseña.`,
      actual
    );
    if (correo === null || correo.trim() === actual) return;
    try {
      const res = await apiAdmin(`/api/admin/usuarios/${id}/correo`, conJSON("PUT", { correo: correo.trim() }));
      alert(await mensaje(res));
      if (res.ok) {
        cargarUsuarios();
        cargarMetricas();
      }
    } catch {
      alert("Error al actualizar el correo.");
    }
  }

  async function confirmarCorreo(id: number) {
    if (!confirm(`¿Dar por confirmado el correo del usuario #${id}? Hazlo solo si comprobaste que el correo es suyo.`)) return;
    try {
      const res = await apiAdmin(`/api/admin/usuarios/${id}/verificar`, { method: "PUT" });
      alert(await mensaje(res));
      if (res.ok) {
        cargarUsuarios();
        cargarMetricas();
      }
    } catch {
      alert("Error al actualizar la cuenta.");
    }
  }

  async function cambiarEstado(id: number, nuevoEstado: string) {
    if (!nuevoEstado) return;
    try {
      const res = await apiAdmin(`/api/admin/usuarios/${id}/estado`, conJSON("PUT", { nuevoEstado }));
      alert(await mensaje(res));
      cargarUsuarios();
    } catch {
      alert("Error al actualizar el estado del usuario.");
    }
  }

  async function eliminarUsuario(id: number) {
    if (!confirm(`¿Estás seguro de eliminar el usuario #${id}? Esta acción borrará todas sus publicaciones y registros.`)) return;
    try {
      const res = await apiAdmin(`/api/admin/usuarios/${id}`, { method: "DELETE" });
      alert(await mensaje(res));
      cargarUsuarios();
      cargarMetricas();
    } catch {
      alert("Error al eliminar el usuario.");
    }
  }

  async function eliminarOferta(id: number) {
    if (!confirm(`¿Deseas eliminar la oferta #${id}?`)) return;
    try {
      const res = await apiAdmin(`/api/admin/ofertas/${id}`, { method: "DELETE" });
      alert(await mensaje(res));
      cargarOfertas();
      cargarMetricas();
    } catch {
      alert("Error al eliminar la oferta.");
    }
  }

  // 4. CATEGORÍAS
  async function crearCategoria(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await apiAdmin(
        "/api/admin/categorias",
        conJSON("POST", { nombreCategoria: catNombre.trim(), descripcion: catDesc.trim() })
      );
      alert(await mensaje(res));
      if (res.ok) {
        setCatNombre("");
        setCatDesc("");
        olvidarCategorias();
      }
    } catch {
      alert("Error al intentar registrar la categoría.");
    }
  }

  // Cuentas que no pueden entrar por su correo (inválido o sin confirmar)
  const avisos: string[] = [];
  if (metricas.correosInvalidos)
    avisos.push(
      `${cuentas(metricas.correosInvalidos)} con un correo inválido (no puede${metricas.correosInvalidos === 1 ? "" : "n"} iniciar sesión)`
    );
  if (metricas.cuentasSinVerificar) avisos.push(`${cuentas(metricas.cuentasSinVerificar)} sin confirmar su correo`);

  const kpis: [string, string, string, number | undefined][] = [
    ["ti-users", "Total Usuarios", "kpi-usuarios", metricas.totalUsuarios],
    ["ti-truck", "Proveedores", "kpi-proveedores", metricas.totalProveedores],
    ["ti-shoe", "Emprendedores", "kpi-emprendedores", metricas.totalEmprendedores],
    ["ti-box", "Ofertas Publicadas", "kpi-ofertas", metricas.totalOfertas],
  ];

  return (
    <>
      {/* 1. MÉTRICAS GLOBALES */}
      <section className="metrics-grid">
        {kpis.map(([icono, titulo, id, valor]) => (
          <div className="metric-card" key={id}>
            <div className="metric-icon">
              <i className={`ti ${icono}`} aria-hidden="true" />
            </div>
            <div className="metric-info">
              <h4>{titulo}</h4>
              <p id={id}>{valor || 0}</p>
            </div>
          </div>
        ))}
      </section>

      {/* 2. GESTIÓN DE USUARIOS */}
      <section className="panel-section">
        <div className="panel-header">
          <h3 className="panel-title">
            <i className="ti ti-users-group" aria-hidden="true" /> Gestión General de Usuarios
          </h3>
        </div>
        <div className="aviso-correos" id="avisoCorreos" hidden={avisos.length === 0}>
          <i className="ti ti-alert-triangle" aria-hidden="true" /> Hay {avisos.join(" y ")}. Marca{" "}
          <strong>&quot;Solo cuentas con problemas de correo&quot;</strong> para verlas y corregirlas.
        </div>
        <div className="barra-filtros">
          <input
            type="search"
            id="buscarUsuario"
            placeholder="Buscar por nombre o correo..."
            aria-label="Buscar usuarios"
            value={buscar}
            onChange={(e) => alBuscar(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              id="soloProblemas"
              checked={soloProblemas}
              onChange={(e) => {
                setSoloProblemas(e.target.checked);
                cargarUsuarios(1, buscar, e.target.checked);
              }}
            />{" "}
            Solo cuentas con problemas de correo
          </label>
        </div>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre / Razón Social</th>
                <th>Correo Electrónico</th>
                <th>Rol</th>
                <th>Departamento</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="tabla-usuarios-body">
              {!usuarios ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center" }}>
                    Cargando usuarios...
                  </td>
                </tr>
              ) : !usuarios.datos.length ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center" }}>
                    {buscar.trim() || soloProblemas ? "Ningún usuario coincide con la búsqueda." : "No hay usuarios registrados."}
                  </td>
                </tr>
              ) : (
                usuarios.datos.map((u) => {
                  const est = (u.EstadoCuenta || "Activo").toLowerCase();
                  const clase = est === "activo" ? "badge-activo" : est === "suspendido" ? "badge-suspendido" : "badge-inactivo";
                  const id = Number(u.UsuarioID);
                  return (
                    <tr key={id}>
                      <td>#{id}</td>
                      <td>
                        <strong>{u.NombreRazonSocial || "Sin Nombre"}</strong>
                      </td>
                      <td>
                        {u.CorreoElectronico}
                        {!u.CorreoValido && (
                          <span
                            className="etiqueta-correo invalido"
                            title="Le falta el dominio completo (ej. .com): no puede iniciar sesión"
                          >
                            Correo inválido
                          </span>
                        )}
                        {!u.CorreoVerificado && (
                          <span className="etiqueta-correo pendiente" title="No ha abierto el enlace de confirmación">
                            Sin confirmar
                          </span>
                        )}
                      </td>
                      <td>{(u.TipoRol || "Miembro").toUpperCase()}</td>
                      <td>{u.NombreDepartamento || "Managua"}</td>
                      <td>
                        <span className={`badge-status ${clase}`}>{u.EstadoCuenta || "Activo"}</span>
                      </td>
                      <td>
                        <select
                          value=""
                          aria-label={`Cambiar estado del usuario #${id}`}
                          onChange={(e) => cambiarEstado(id, e.target.value)}
                          style={{ fontSize: 11, padding: 3 }}
                        >
                          <option value="">Cambiar estado...</option>
                          <option value="Activo">Activo</option>
                          <option value="Inactivo">Inactivo</option>
                          <option value="Suspendido">Suspendido</option>
                        </select>
                        <button
                          onClick={() => corregirCorreo(id, u.CorreoElectronico || "")}
                          className="btn-action btn-correo"
                          style={{ marginLeft: 4 }}
                          title="Corregir correo"
                          aria-label="Corregir correo"
                        >
                          <i className="ti ti-mail-cog" aria-hidden="true" />
                        </button>
                        {!u.CorreoVerificado && (
                          <button
                            onClick={() => confirmarCorreo(id)}
                            className="btn-action btn-correo"
                            style={{ marginLeft: 4 }}
                            title="Dar el correo por confirmado"
                            aria-label="Dar el correo por confirmado"
                          >
                            <i className="ti ti-mail-check" aria-hidden="true" />
                          </button>
                        )}
                        <button
                          onClick={() => eliminarUsuario(id)}
                          className="btn-action btn-delete"
                          style={{ marginLeft: 4 }}
                          title="Eliminar usuario"
                          aria-label="Eliminar usuario"
                        >
                          <i className="ti ti-trash" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="paginacion-admin" id="paginacion-usuarios">
          <Paginacion datos={usuarios} ir={(p) => cargarUsuarios(p)} />
        </div>
      </section>

      {/* 3. MODERACIÓN DE OFERTAS Y PUBLICACIONES */}
      <section className="panel-section">
        <div className="panel-header">
          <h3 className="panel-title">
            <i className="ti ti-shopping-bag" aria-hidden="true" /> Moderación de Insumos / Ofertas
          </h3>
        </div>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>ID Oferta</th>
                <th>Título Material</th>
                <th>Categoría</th>
                <th>Precio (C$)</th>
                <th>Unidad</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="tabla-ofertas-body">
              {!ofertas ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center" }}>
                    Cargando ofertas...
                  </td>
                </tr>
              ) : !ofertas.datos.length ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center" }}>
                    No hay ofertas disponibles.
                  </td>
                </tr>
              ) : (
                ofertas.datos.map((o) => (
                  <tr key={o.OfertaID}>
                    <td>#{o.OfertaID}</td>
                    <td>
                      <strong>{o.TituloMaterial}</strong>
                    </td>
                    <td>{o.NombreCategoria || "General"}</td>
                    <td>C$ {o.Precio}</td>
                    <td>{o.UnidadMedida}</td>
                    <td>
                      <button onClick={() => eliminarOferta(o.OfertaID)} className="btn-action btn-delete">
                        <i className="ti ti-trash" aria-hidden="true" /> Eliminar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="paginacion-admin" id="paginacion-ofertas">
          <Paginacion datos={ofertas} ir={(p) => cargarOfertas(p)} />
        </div>
      </section>

      {/* 4. GESTIÓN DE CATEGORÍAS */}
      <section className="panel-section">
        <div className="panel-header">
          <h3 className="panel-title">
            <i className="ti ti-category" aria-hidden="true" /> Agregar Nueva Categoría de Materiales
          </h3>
        </div>
        <form onSubmit={crearCategoria} className="form-grid">
          <div className="form-group">
            <label htmlFor="catNombre">Nombre de Categoría</label>
            <input
              type="text"
              id="catNombre"
              className="form-control"
              placeholder="Ej. Hilos y Costuras"
              required
              value={catNombre}
              onChange={(e) => setCatNombre(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="catDesc">Descripción (Opcional)</label>
            <input
              type="text"
              id="catDesc"
              className="form-control"
              placeholder="Hilos de nylon, cera o reforzados"
              value={catDesc}
              onChange={(e) => setCatDesc(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-submit">
            <i className="ti ti-plus" aria-hidden="true" /> Guardar
          </button>
        </form>
      </section>
    </>
  );
}
