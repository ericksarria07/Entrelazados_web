// Pestaña "Favoritos y Alertas" (antes mercado-favoritos.js): alertas de búsqueda y
// publicaciones guardadas, paginadas por el servidor.
"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, conJSON } from "@/lib/cliente/api";
import type { Categoria } from "@/lib/cliente/categorias";
import { Paginacion } from "./Comunes";
import type { Oferta, Pagina } from "./tipos";

type Alerta = { id: number; descripcion: string };
const POR_PAGINA = 6;

export async function enviarAlerta(datos: Record<string, unknown>) {
  const res = await api("/api/alertas", conJSON("POST", datos));
  const r = (await res.json().catch(() => ({}))) as { message?: string };
  return { ok: res.ok, message: r.message || (res.ok ? "Alerta creada." : "No se pudo crear la alerta.") };
}

export type ManejoFavoritos = { recargar: () => void; enfocarAlerta: () => void };

const Favoritos = forwardRef<
  ManejoFavoritos,
  {
    visible: boolean;
    categorias: Categoria[];
    tarjeta: (o: Oferta) => ReactNode;
    alCargar: (lista: Oferta[]) => void;
  }
>(function Favoritos({ visible, categorias, tarjeta, alCargar }, ref) {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [errorAlertas, setErrorAlertas] = useState(false);
  const [favoritos, setFavoritos] = useState<Pagina<Oferta> | null>(null);
  const [errorFav, setErrorFav] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState({ palabra: "", categoria: "", precio: "" });
  const [guardando, setGuardando] = useState(false);
  const palabra = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const desplazar = useRef(false);
  const alCargarRef = useRef(alCargar);
  useEffect(() => {
    alCargarRef.current = alCargar;
  });

  useImperativeHandle(ref, () => ({
    recargar: () => setVersion((v) => v + 1),
    enfocarAlerta: () => setTimeout(() => palabra.current?.focus(), 50),
  }));

  const cargarAlertas = useCallback(async () => {
    try {
      const res = await api("/api/alertas");
      setAlertas(res.ok ? ((await res.json()) as Alerta[]) : []);
      setErrorAlertas(false);
    } catch {
      setErrorAlertas(true);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(cargarAlertas, 0);
    return () => clearTimeout(t);
  }, [visible, cargarAlertas]);

  useEffect(() => {
    if (!visible) return;
    let vivo = true;
    api(`/api/favoritos?pagina=${pagina}&porPagina=${POR_PAGINA}`)
      .then((r) => {
        if (!r.ok) throw new Error("sin datos");
        return r.json() as Promise<Pagina<Oferta>>;
      })
      .then((d) => {
        if (!vivo) return;
        // Se quitó lo último de la última página: se muestra la anterior
        if (d.datos.length === 0 && d.total > 0 && pagina > 1) return setPagina(d.paginas);
        setFavoritos(d);
        setErrorFav(false);
        alCargarRef.current(d.datos);
        if (desplazar.current) lista.current?.scrollIntoView({ behavior: "smooth" });
        desplazar.current = false;
      })
      .catch(() => vivo && setErrorFav(true));
    return () => {
      vivo = false;
    };
  }, [visible, pagina, version]);

  async function guardarAlerta(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const r = await enviarAlerta({
        palabraClave: form.palabra.trim(),
        categoriaId: form.categoria || null,
        precioMaximo: form.precio || null,
      });
      alert(r.message);
      if (r.ok) {
        setForm({ palabra: "", categoria: "", precio: "" });
        cargarAlertas();
      }
    } catch {
      alert("Error al conectar con el servidor.");
    } finally {
      setGuardando(false);
    }
  }

  async function borrarAlerta(id: number) {
    try {
      const res = await api(`/api/alertas/${id}`, { method: "DELETE" });
      if (!res.ok) alert(((await res.json().catch(() => ({}))) as { message?: string }).message || "No se pudo borrar la alerta.");
    } catch {
      alert("Error al conectar con el servidor.");
    }
    cargarAlertas();
  }

  return (
    <div id="tab-favorites" className="section" style={{ display: visible ? "block" : "none" }}>
      <div className="filter-bar">
        <div className="titulo-bloque">
          <i className="ti ti-bell-ringing" style={{ color: "var(--color-principal)" }} aria-hidden="true" /> Mis alertas de búsqueda
        </div>
        <p className="nota-bloque">Te avisamos en la campana y por correo cuando alguien publique algo así. Hasta 10 alertas.</p>
        <form className="form-alerta" onSubmit={guardarAlerta}>
          <div>
            <label className="form-label" htmlFor="alertaPalabra">
              Palabra clave
            </label>
            <input
              ref={palabra}
              className="form-input"
              id="alertaPalabra"
              maxLength={60}
              placeholder="Ej. cuero café, suela TR"
              value={form.palabra}
              onChange={(e) => setForm((f) => ({ ...f, palabra: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="alertaCategoria">
              Categoría
            </label>
            <select
              className="form-input"
              id="alertaCategoria"
              style={{ height: 42 }}
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
            >
              <option value="">Cualquier categoría</option>
              {categorias.map((c) => (
                <option key={c.CategoriaID} value={String(c.CategoriaID)}>
                  {c.NombreCategoria}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="alertaPrecio">
              Precio máx. (C$)
            </label>
            <input
              className="form-input"
              id="alertaPrecio"
              type="number"
              min="1"
              step="0.01"
              placeholder="Opcional"
              value={form.precio}
              onChange={(e) => setForm((f) => ({ ...f, precio: e.target.value }))}
            />
          </div>
          <button type="submit" className="btn-primary" id="btnGuardarAlerta" disabled={guardando}>
            <i className="ti ti-bell-plus" aria-hidden="true" /> Crear alerta
          </button>
        </form>
        <div className="lista-alertas" id="lista-alertas" aria-live="polite">
          {errorAlertas ? (
            <span className="nota-bloque" style={{ margin: 0 }}>
              No se pudieron cargar tus alertas.
            </span>
          ) : alertas && !alertas.length ? (
            <span className="nota-bloque" style={{ margin: 0 }}>
              Todavía no tienes alertas.
            </span>
          ) : (
            alertas?.map((a) => (
              <span className="chip-alerta" key={a.id}>
                <i className="ti ti-bell" aria-hidden="true" /> {a.descripcion}
                <button type="button" onClick={() => borrarAlerta(Number(a.id))} aria-label={`Borrar la alerta ${a.descripcion}`} title="Borrar alerta">
                  &times;
                </button>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="filter-bar" style={{ marginBottom: 14 }}>
        <div className="titulo-bloque">
          <i className="ti ti-heart-filled" style={{ color: "var(--color-terciario)" }} aria-hidden="true" /> Publicaciones guardadas
        </div>
        <p className="nota-bloque" style={{ marginBottom: 0 }}>
          Guarda una publicación con el corazón. Si baja de precio, te avisamos.
        </p>
      </div>
      <div className="listings" id="contenedor-favoritos" ref={lista}>
        {errorFav ? (
          <p className="vacio-oscuro" style={{ color: "#ffb4a8" }}>
            No se pudieron cargar tus favoritos.
          </p>
        ) : !favoritos ? (
          <p className="vacio-oscuro">Cargando tus favoritos…</p>
        ) : favoritos.total === 0 ? (
          <p className="vacio-oscuro">
            <i className="ti ti-heart" aria-hidden="true" /> Todavía no guardaste publicaciones. Toca el corazón de una oferta para guardarla
            aquí.
          </p>
        ) : (
          favoritos.datos.map(tarjeta)
        )}
      </div>
      <div className="paginacion" id="paginacion-favoritos">
        {!errorFav && favoritos && favoritos.total > 0 && (
          <Paginacion
            datos={favoritos}
            ir={(p) => {
              desplazar.current = true;
              setPagina(p);
            }}
          />
        )}
      </div>
    </div>
  );
});

export default Favoritos;
