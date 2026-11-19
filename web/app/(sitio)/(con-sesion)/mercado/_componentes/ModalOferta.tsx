// ==========================================================================
// PUBLICAR O EDITAR UNA OFERTA (antes mercado-publicar.js)
// - Cada foto se reduce en el navegador (máx. 1600 px, WebP o JPG) antes de subirla.
// - Asistente de IA: "Completar con IA" (/api/ia/publicacion) y "Sugerir precio" (/api/ia/precio).
// ==========================================================================
"use client";
/* eslint-disable @next/next/no-img-element -- vistas previas (blob:) y fotos ya subidas */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, conJSON } from "@/lib/cliente/api";
import type { Categoria } from "@/lib/cliente/categorias";
import type { Oferta } from "./tipos";

const MAX_FOTOS = 5;
const LADO_MAXIMO = 1600;

function reducirFoto(archivo: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * escala);
      canvas.height = Math.round(img.naturalHeight * escala);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          // Safari antiguo no genera WebP: en ese caso se usa JPG
          if (blob && blob.type === "image/webp") return resolve(blob);
          canvas.toBlob((jpg) => (jpg ? resolve(jpg) : reject(new Error("No se pudo procesar la foto"))), "image/jpeg", 0.85);
        },
        "image/webp",
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("El archivo no es una imagen válida"));
    };
    img.src = url;
  });
}

type FotoNueva = { blob: Blob; url: string };
const VACIO = { titulo: "", descripcion: "", precio: "", unidad: "", distancia: "", categoriaId: "" };

export default function ModalOferta({
  editando,
  categorias,
  alCerrar,
  alGuardar,
}: {
  editando: Oferta | null;
  categorias: Categoria[];
  alCerrar: () => void;
  alGuardar: (editada: boolean) => void;
}) {
  // Se monta al abrir: arranca vacío o con los datos de la publicación que se edita
  const [form, setForm] = useState(() =>
    editando
      ? {
          titulo: editando.TituloMaterial,
          descripcion: editando.Descripcion || "",
          precio: String(parseFloat(String(editando.Precio))),
          unidad: editando.UnidadMedida,
          distancia: String(Number(editando.DistanciaSimuladaKm) || 0),
          categoriaId: String(editando.CategoriaID),
        }
      : VACIO
  );
  const [fotos, setFotos] = useState<FotoNueva[]>([]);
  const [existentes] = useState<string[]>(() => (Array.isArray(editando?.Fotos) ? [...editando.Fotos] : []));
  const [quitar, setQuitar] = useState<string[]>([]);
  const [ia, setIa] = useState<{ contenido: ReactNode; error: boolean } | null>(null);
  const [ocupado, setOcupado] = useState<"" | "guardar" | "describir" | "precio">("");
  const entradaFotos = useRef<HTMLInputElement>(null);
  const titulo = useRef<HTMLInputElement>(null);
  const precio = useRef<HTMLInputElement>(null);
  const fotosRef = useRef(fotos);
  useEffect(() => {
    fotosRef.current = fotos;
  });

  useEffect(() => {
    const t = setTimeout(() => titulo.current?.focus(), 50);
    // Al cerrar se liberan las vistas previas
    return () => {
      clearTimeout(t);
      fotosRef.current.forEach((f) => URL.revokeObjectURL(f.url));
    };
  }, []);

  const cambiar = (campo: keyof typeof VACIO) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const visibles = existentes.filter((u) => !quitar.includes(u));

  async function elegirFotos(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []);
    e.target.value = "";
    const espacio = MAX_FOTOS - fotos.length - visibles.length;
    if (archivos.length > espacio) {
      alert(
        espacio > 0
          ? `Puedes subir como máximo ${MAX_FOTOS} fotos. Se agregarán solo las primeras ${espacio}.`
          : `Ya tienes ${MAX_FOTOS} fotos, el máximo por oferta.`
      );
    }
    for (const archivo of archivos.slice(0, Math.max(0, espacio))) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(archivo.type)) {
        alert(`"${archivo.name}" no es una foto JPG, PNG o WebP.`);
        continue;
      }
      try {
        const blob = await reducirFoto(archivo);
        setFotos((f) => [...f, { blob, url: URL.createObjectURL(blob) }]);
      } catch (err) {
        alert(`No se pudo usar "${archivo.name}": ${(err as Error).message}.`);
      }
    }
  }

  function quitarNueva(i: number) {
    setFotos((f) => {
      URL.revokeObjectURL(f[i]?.url);
      return f.filter((_, j) => j !== i);
    });
  }

  async function guardar() {
    const { titulo: t, precio: p, unidad, distancia, categoriaId } = form;
    if (!t.trim() || !p.trim() || !unidad.trim() || !categoriaId) {
      alert("Por favor llena todos los campos obligatorios.");
      return;
    }
    // Los datos y las fotos viajan juntos como formulario (multipart/form-data)
    const datos = new FormData();
    if (editando && quitar.length) datos.append("fotosQuitar", JSON.stringify(quitar));
    datos.append("titulo", t.trim());
    datos.append("descripcion", form.descripcion.trim());
    datos.append("precio", String(parseFloat(p)));
    datos.append("unidad", unidad.trim());
    datos.append("distancia", String(parseInt(distancia) || 0));
    datos.append("categoriaId", String(parseInt(categoriaId)));
    fotos.forEach((f, i) => datos.append("fotos", f.blob, `foto-${i + 1}.${f.blob.type === "image/webp" ? "webp" : "jpg"}`));

    setOcupado("guardar");
    try {
      const res = editando
        ? await api(`/api/ofertas/${editando.OfertaID}`, { method: "PUT", body: datos })
        : await api("/api/ofertas", { method: "POST", body: datos });
      const r = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        alert("¡Éxito! " + r.message);
        alGuardar(!!editando);
      } else alert("Error: " + r.message);
    } catch {
      alert("Error de red al guardar la oferta.");
    } finally {
      setOcupado("");
    }
  }

  // Foto para la IA: la primera nueva o, al editar, la primera que ya tenía
  async function primeraFoto(): Promise<Blob | null> {
    if (fotos.length) return fotos[0].blob;
    if (!visibles[0]) return null;
    try {
      const res = await fetch(visibles[0]);
      return res.ok ? await res.blob() : null;
    } catch {
      return null;
    }
  }

  async function completarConIA() {
    const t = form.titulo.trim();
    setOcupado("describir");
    try {
      const foto = await primeraFoto();
      if (!foto && !t) {
        setIa({ contenido: "Primero sube una foto del material o escribe el título.", error: true });
        return;
      }
      const datos = new FormData();
      if (foto) datos.append("fotos", foto, `foto.${foto.type === "image/webp" ? "webp" : foto.type === "image/png" ? "png" : "jpg"}`);
      if (t) datos.append("titulo", t);
      setIa({
        contenido: (
          <>
            <i className="ti ti-sparkles" aria-hidden="true" /> La IA está mirando tu material…
          </>
        ),
        error: false,
      });
      const res = await api("/api/ia/publicacion", { method: "POST", body: datos });
      const r = (await res.json().catch(() => ({}))) as {
        message?: string;
        titulo?: string;
        descripcion?: string;
        unidad?: string;
        categoriaId?: number;
        categoria?: string;
      };
      if (!res.ok) {
        setIa({ contenido: r.message || "La IA no pudo ayudarte esta vez.", error: true });
        return;
      }
      setForm((f) => ({
        ...f,
        titulo: r.titulo || f.titulo,
        descripcion: r.descripcion || f.descripcion,
        unidad: r.unidad || f.unidad,
        categoriaId: r.categoriaId ? String(r.categoriaId) : f.categoriaId,
      }));
      setIa({
        contenido: (
          <>
            <strong>
              <i className="ti ti-check" aria-hidden="true" /> Listo.
            </strong>{" "}
            Llené el título, la descripción, la unidad{r.categoria ? ` y la categoría (${r.categoria})` : ""}. Revísalos y cambia lo que
            haga falta antes de publicar.
          </>
        ),
        error: false,
      });
    } catch {
      setIa({ contenido: "Error al conectar con el servidor.", error: true });
    } finally {
      setOcupado("");
    }
  }

  async function sugerirPrecio() {
    if (!form.categoriaId) {
      setIa({ contenido: "Elige primero la categoría del material para comparar con publicaciones parecidas.", error: true });
      return;
    }
    setOcupado("precio");
    try {
      const res = await api(
        "/api/ia/precio",
        conJSON("POST", {
          titulo: form.titulo.trim(),
          categoriaId: Number(form.categoriaId),
          unidad: form.unidad.trim(),
          ofertaId: editando?.OfertaID ?? null,
        })
      );
      const r = (await res.json().catch(() => ({}))) as {
        message?: string;
        sugerido?: number;
        explicacion?: string;
        fuente?: string;
        muestras?: number;
        rango?: { minimo: number; maximo: number };
      };
      if (!res.ok) return setIa({ contenido: r.message || "No se pudo calcular un precio.", error: true });
      if (!r.sugerido) return setIa({ contenido: r.explicacion, error: false });
      const sugerido = Number(r.sugerido);
      setIa({
        contenido: (
          <>
            <strong>
              <i className="ti ti-coin" aria-hidden="true" /> Precio sugerido: C$ {sugerido.toFixed(2)}
            </strong>
            {r.fuente === "ia" && (
              <span className="badge badge-mat" style={{ marginLeft: 4 }}>
                IA
              </span>
            )}
            <br />
            {r.explicacion}
            {r.rango && (
              <>
                <br />
                <small>
                  Rango en la plataforma: C$ {r.rango.minimo.toFixed(2)} – C$ {r.rango.maximo.toFixed(2)} ({r.muestras} precio
                  {r.muestras === 1 ? "" : "s"})
                </small>
              </>
            )}
            <br />
            <button
              type="button"
              className="btn-sm cta"
              onClick={() => {
                setForm((f) => ({ ...f, precio: String(sugerido) }));
                precio.current?.focus();
              }}
            >
              Usar C$ {sugerido.toFixed(2)}
            </button>
          </>
        ),
        error: false,
      });
    } catch {
      setIa({ contenido: "Error al conectar con el servidor.", error: true });
    } finally {
      setOcupado("");
    }
  }

  return (
    <div
      id="modalOferta"
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="encabezadoModalOferta"
      style={{ display: "block" }}
      onKeyDown={(e) => e.key === "Escape" && alCerrar()}
    >
      <div className="modal-content">
        <button type="button" className="close-btn" onClick={alCerrar} aria-label="Cerrar" style={{ border: "none", background: "none" }}>
          &times;
        </button>
        <h3
          id="encabezadoModalOferta"
          style={{ marginBottom: 18, color: "var(--color-secundario)", display: "flex", alignItems: "center", gap: 8 }}
        >
          <i className="ti ti-package" style={{ color: "var(--color-principal)" }} aria-hidden="true" />{" "}
          <span id="tituloModalOferta">{editando ? "Editar publicación" : "Publicar Oferta Directa"}</span>
        </h3>

        <div className="caja-ia">
          <div className="titulo-ia">
            <i className="ti ti-sparkles" aria-hidden="true" /> Asistente de IA
          </div>
          <p>
            Sube una foto (o escribe el título) y la IA propone el título, la descripción, la categoría y la unidad. También te sugiere
            un precio comparando con publicaciones parecidas. Revisa siempre lo que propone.
          </p>
          <div className="botones-ia">
            <button type="button" className="btn-sm" id="btnIaDescribir" disabled={!!ocupado} onClick={completarConIA}>
              <i className={`ti ${ocupado === "describir" ? "ti-loader-2" : "ti-wand"}`} aria-hidden="true" />{" "}
              {ocupado === "describir" ? "Analizando…" : "Completar con IA"}
            </button>
            <button type="button" className="btn-sm" id="btnIaPrecio" disabled={!!ocupado} onClick={sugerirPrecio}>
              <i className={`ti ${ocupado === "precio" ? "ti-loader-2" : "ti-coin"}`} aria-hidden="true" />{" "}
              {ocupado === "precio" ? "Comparando…" : "Sugerir precio"}
            </button>
          </div>
          <div className={`resultado-ia${ia?.error ? " error" : ""}`} id="resultadoIA" role="status" aria-live="polite" hidden={!ia}>
            {ia?.contenido}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="ofertaTitulo">
            Título del Material
          </label>
          <input
            ref={titulo}
            className="form-input"
            type="text"
            id="ofertaTitulo"
            maxLength={120}
            placeholder="Ej. Lote Suelas TR Caballero"
            value={form.titulo}
            onChange={cambiar("titulo")}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="ofertaDescripcion">
            Descripción <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(opcional)</span>
          </label>
          <textarea
            className="form-input"
            id="ofertaDescripcion"
            maxLength={1000}
            placeholder="Color, grosor, acabado, para qué sirve..."
            aria-describedby="contadorDescripcion"
            value={form.descripcion}
            onChange={cambiar("descripcion")}
          />
          <div className="contador" id="contadorDescripcion">
            {form.descripcion.length} / 1000
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="ofertaPrecio">
            Precio (C$)
          </label>
          <input
            ref={precio}
            className="form-input"
            type="number"
            id="ofertaPrecio"
            min="0.01"
            step="0.01"
            placeholder="Ej. 450"
            value={form.precio}
            onChange={cambiar("precio")}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="ofertaUnidad">
            Unidad de Medida
          </label>
          <input
            className="form-input"
            type="text"
            id="ofertaUnidad"
            maxLength={30}
            placeholder="Ej. por par, por pie², por docena"
            value={form.unidad}
            onChange={cambiar("unidad")}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="ofertaDistancia">
            Distancia Simulada (Km)
          </label>
          <input
            className="form-input"
            type="number"
            id="ofertaDistancia"
            placeholder="Ej. 15"
            value={form.distancia}
            onChange={cambiar("distancia")}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="ofertaCategoria">
            Categoría del Material
          </label>
          <select className="form-input" id="ofertaCategoria" style={{ height: 42 }} value={form.categoriaId} onChange={cambiar("categoriaId")}>
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

        <div className="form-group">
          <span className="form-label">Fotografías del Producto</span>
          <div
            className="upload-box"
            role="button"
            tabIndex={0}
            aria-label="Tomar o seleccionar fotos del material"
            onClick={() => entradaFotos.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                entradaFotos.current?.click();
              }
            }}
          >
            <i className="ti ti-camera-plus upload-box-icon" aria-hidden="true" />
            <div className="upload-box-text">Tomar o seleccionar fotos del material</div>
            <div className="upload-box-subtext">Hasta 5 fotos en total (JPG, PNG o WebP). Se reducen automáticamente antes de subirlas.</div>
          </div>
          <input
            ref={entradaFotos}
            type="file"
            id="inputFotos"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: "none" }}
            onChange={elegirFotos}
          />
          <div className="photo-preview-grid" id="previewGrid">
            {existentes.map((url, i) =>
              quitar.includes(url) ? null : (
                <div className="photo-preview-item existente" title="Foto actual" key={url}>
                  <img src={url} alt={`Foto actual ${i + 1}`} />
                  <button
                    type="button"
                    className="photo-preview-remove"
                    onClick={() => setQuitar((q) => [...q, url])}
                    title="Quitar esta foto"
                    aria-label="Quitar esta foto"
                  >
                    &times;
                  </button>
                </div>
              )
            )}
            {fotos.map((f, i) => (
              <div className="photo-preview-item" key={f.url}>
                <img src={f.url} alt={`Vista previa ${i + 1}`} />
                <button type="button" className="photo-preview-remove" onClick={() => quitarNueva(i)} aria-label="Quitar esta foto">
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>

        <button
          className="btn-primary"
          id="btnGuardarOferta"
          style={{ width: "100%", marginTop: 10, padding: 12 }}
          disabled={ocupado === "guardar"}
          onClick={guardar}
        >
          {ocupado === "guardar" ? (
            fotos.length ? "Subiendo fotos…" : editando ? "Guardando…" : "Publicando…"
          ) : editando ? (
            <>
              Guardar cambios <i className="ti ti-device-floppy" aria-hidden="true" />
            </>
          ) : (
            "Guardar y Publicar Oferta ↗"
          )}
        </button>
      </div>
    </div>
  );
}
