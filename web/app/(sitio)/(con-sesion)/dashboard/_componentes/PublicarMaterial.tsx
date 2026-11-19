// Publicar nueva materia prima desde el dashboard (proveedores): oferta + subasta de 7 días
"use client";
import { useState, type FormEvent } from "react";
import { api, conJSON } from "@/lib/cliente/api";
import { useCategorias } from "@/lib/cliente/categorias";

export default function PublicarMaterial({
  avisar,
  alPublicar,
}: {
  avisar: (texto: string, error?: boolean) => void;
  alPublicar: () => void;
}) {
  const categorias = useCategorias();
  const [form, setForm] = useState({ titulo: "", categoriaId: "", precio: "", unidad: "" });
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function publicar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const res = await api(
        "/api/ofertas",
        conJSON("POST", {
          titulo: form.titulo.trim(),
          categoriaId: Number(form.categoriaId),
          precio: parseFloat(form.precio),
          unidad: form.unidad.trim(),
          distancia: 0,
          fotos: [],
        })
      );
      const r = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        avisar(r.message || "¡Material publicado con éxito!");
        setForm({ titulo: "", categoriaId: "", precio: "", unidad: "" });
        alPublicar();
      } else {
        avisar(r.message || "Error al publicar el material.", true);
      }
    } catch {
      avisar("Error de conexión con el servidor.", true);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <article className="card" id="cardPublicacion">
      <div className="card-cabecera">
        <div>
          <h2>
            <i className="ti ti-package-import" aria-hidden="true" /> Publicar nueva materia prima
          </h2>
          <p className="card-sub">Se crea la oferta y su lote en subasta por 7 días</p>
        </div>
      </div>
      <form id="formPublicar" onSubmit={publicar}>
        <div className="form-group">
          <label htmlFor="pubTitulo">Título del material</label>
          <input
            type="text"
            id="pubTitulo"
            className="form-control"
            placeholder="Ej. Cuero vacuno castaño"
            maxLength={150}
            required
            value={form.titulo}
            onChange={cambiar("titulo")}
          />
        </div>
        <div className="form-group">
          <label htmlFor="pubCategoria">Categoría</label>
          <select id="pubCategoria" className="form-control" required value={form.categoriaId} onChange={cambiar("categoriaId")}>
            {!categorias ? (
              <option value="">Cargando categorías…</option>
            ) : categorias.length ? (
              <>
                <option value="">Selecciona una categoría</option>
                {categorias.map((c) => (
                  <option key={c.CategoriaID} value={String(c.CategoriaID)}>
                    {c.NombreCategoria}
                  </option>
                ))}
              </>
            ) : (
              <option value="">No hay categorías disponibles</option>
            )}
          </select>
        </div>
        <div className="form-fila">
          <div className="form-group">
            <label htmlFor="pubPrecio">Precio (C$)</label>
            <input
              type="number"
              id="pubPrecio"
              className="form-control"
              placeholder="120"
              min="1"
              step="0.01"
              required
              value={form.precio}
              onChange={cambiar("precio")}
            />
          </div>
          <div className="form-group">
            <label htmlFor="pubUnidad">Unidad de medida</label>
            <input
              type="text"
              id="pubUnidad"
              className="form-control"
              placeholder="Pie² / Litro / Par"
              maxLength={30}
              required
              value={form.unidad}
              onChange={cambiar("unidad")}
            />
          </div>
        </div>
        <button type="submit" className="btn btn-principal" id="btnPublicar" disabled={enviando}>
          <i className="ti ti-upload" aria-hidden="true" /> Publicar oferta y subasta
        </button>
      </form>
    </article>
  );
}
