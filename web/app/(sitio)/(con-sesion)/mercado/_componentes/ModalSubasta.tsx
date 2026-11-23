// Crear una subasta: lote nuevo o a partir de una de mis publicaciones
"use client";
import { useEffect, useRef, useState } from "react";
import { api, conJSON } from "@/lib/cliente/api";
import type { Categoria } from "@/lib/cliente/categorias";
import { useFocoModal } from "@/lib/cliente/foco";
import type { Oferta } from "./tipos";

const VACIO = { ofertaId: "", titulo: "", precioBase: "", dias: "7", categoriaId: "" };

export default function ModalSubasta({
  abierto,
  miId,
  categorias,
  alCerrar,
  alCrear,
}: {
  abierto: boolean;
  miId: number;
  categorias: Categoria[];
  alCerrar: () => void;
  alCrear: () => void;
}) {
  const [form, setForm] = useState(VACIO);
  const [mias, setMias] = useState<Oferta[]>([]);
  const [enviando, setEnviando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useFocoModal(caja, abierto);

  // Al abrir: TODAS mis publicaciones, por si el lote sale de una de ellas
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    api(`/api/ofertas?proveedorId=${encodeURIComponent(String(miId))}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: Oferta[]) => vivo && setMias(Array.isArray(lista) ? lista : []))
      .catch(() => vivo && setMias([]));
    return () => {
      vivo = false;
    };
  }, [abierto, miId]);

  const elegida = mias.find((o) => String(o.OfertaID) === form.ofertaId);

  function cerrar() {
    setForm(VACIO);
    alCerrar();
  }

  // Al elegir una publicación propia se copian su título, precio y categoría
  function elegirPublicacion(id: string) {
    const o = mias.find((x) => String(x.OfertaID) === id);
    setForm((f) =>
      o
        ? { ...f, ofertaId: id, titulo: o.TituloMaterial, precioBase: String(parseFloat(String(o.Precio))), categoriaId: String(o.CategoriaID) }
        : { ...f, ofertaId: "" }
    );
  }

  async function guardar() {
    const precioBase = parseFloat(form.precioBase);
    if (!form.titulo.trim() || !form.categoriaId || !(precioBase > 0)) {
      alert("Escribe el título del lote, el precio base (mayor que 0) y elige una categoría.");
      return;
    }
    setEnviando(true);
    try {
      // El proveedor lo toma el servidor de la sesión
      const res = await api(
        "/api/subastas",
        conJSON("POST", {
          ofertaId: form.ofertaId ? parseInt(form.ofertaId, 10) : null,
          tituloLote: form.titulo.trim(),
          precioBase,
          categoriaId: parseInt(form.categoriaId, 10),
          dias: parseInt(form.dias, 10),
        })
      );
      const r = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        alert(r.message || "¡Subasta creada correctamente!");
        setForm(VACIO);
        alCrear();
      } else alert("Error: " + r.message);
    } catch {
      alert("Error de red al publicar la subasta.");
    } finally {
      setEnviando(false);
    }
  }

  const cambiar = (campo: keyof typeof VACIO) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  return (
    <div
      id="modalSubasta"
      ref={caja}
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="encabezadoModalSubasta"
      style={{ display: abierto ? "block" : "none" }}
      onKeyDown={(e) => e.key === "Escape" && cerrar()}
    >
      <div className="modal-content" style={{ borderTopColor: "var(--color-terciario)" }}>
        <button type="button" className="close-btn" onClick={cerrar} aria-label="Cerrar" style={{ border: "none", background: "none" }}>
          &times;
        </button>
        <h3
          id="encabezadoModalSubasta"
          style={{ marginBottom: 18, color: "var(--color-secundario)", display: "flex", alignItems: "center", gap: 8 }}
        >
          <i className="ti ti-gavel" style={{ color: "var(--color-terciario)" }} aria-hidden="true" /> Crear Nueva Subasta
        </h3>

        <div className="form-group">
          <label className="form-label" htmlFor="subastaOferta">
            ¿Sale de una de tus publicaciones? (opcional)
          </label>
          <select
            className="form-input"
            id="subastaOferta"
            style={{ height: 42 }}
            value={form.ofertaId}
            onChange={(e) => elegirPublicacion(e.target.value)}
          >
            <option value="">No, es un lote nuevo</option>
            {mias.map((o) => (
              <option key={o.OfertaID} value={String(o.OfertaID)}>
                {o.TituloMaterial} · C$ {parseFloat(String(o.Precio)).toFixed(2)}
              </option>
            ))}
          </select>
          <small className="ayuda-form">Si eliges una, el lote muestra sus fotos y se cancela solo si la borras.</small>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="subastaTitulo">
            Título del Lote a Subastar
          </label>
          <input
            className="form-input"
            type="text"
            id="subastaTitulo"
            maxLength={120}
            placeholder="Ej. Lote de 50m2 Gamuza Negra"
            value={form.titulo}
            onChange={cambiar("titulo")}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="subastaPrecioBase">
            Precio Base / Inicial de Salida (C$)
          </label>
          <input
            className="form-input"
            type="number"
            id="subastaPrecioBase"
            min="1"
            step="0.01"
            placeholder="Ej. 1200"
            value={form.precioBase}
            onChange={cambiar("precioBase")}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="subastaDias">
            Duración
          </label>
          <select className="form-input" id="subastaDias" style={{ height: 42 }} value={form.dias} onChange={cambiar("dias")}>
            {[3, 5, 7, 10, 14].map((d) => (
              <option key={d} value={String(d)}>
                {d} días
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="subastaCategoria">
            Categoría del Material
          </label>
          <select
            className="form-input"
            id="subastaCategoria"
            style={{ height: 42 }}
            disabled={!!elegida}
            value={form.categoriaId}
            onChange={cambiar("categoriaId")}
          >
            <option value="" disabled>
              -- Selecciona una categoría --
            </option>
            {categorias.map((c) => (
              <option key={c.CategoriaID} value={String(c.CategoriaID)}>
                {c.NombreCategoria}
              </option>
            ))}
          </select>
        </div>

        <button
          id="btnGuardarSubasta"
          className="btn-primary"
          style={{ backgroundColor: "var(--color-terciario)", width: "100%", marginTop: 10, padding: 12 }}
          disabled={enviando}
          onClick={guardar}
        >
          {enviando ? "Creando subasta…" : "Iniciar Subasta ↗"}
        </button>
      </div>
    </div>
  );
}
