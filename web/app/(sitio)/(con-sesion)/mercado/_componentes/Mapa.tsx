// ==========================================================================
// MAPA DE PROVEEDORES (antes mercado-mapa.js): un círculo por departamento que crece
// con la cantidad de proveedores, y debajo la lista. Leaflet 1.9.4 de npm, cargado
// solo en el navegador. Respeta la categoría elegida en el buscador.
// ==========================================================================
"use client";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type * as L from "leaflet";
import { api } from "@/lib/cliente/api";
import { EnlacePerfil } from "./Comunes";
import { plural } from "./tipos";

type Proveedor = {
  id: number;
  nombre: string;
  ofertas: number;
  calificacion?: number | null;
  totalCalificaciones?: number | null;
  especialidad?: string | null;
  categorias: string[];
};
type Departamento = { departamento: string; lat: number; lng: number; proveedores: Proveedor[] };
type Datos = {
  total: number;
  departamentos: Departamento[];
  sinUbicacion: Proveedor[];
  miUbicacion: { nombre: string; lat: number; lng: number } | null;
};

const COLOR_MAPA = "#7D381B";
const COLOR_MIO = "#2b8a3e";

export default function Mapa({
  visible,
  categoria,
  nombreCategoria,
  miId,
  verPublicacionesDe,
}: {
  visible: boolean;
  categoria: string;
  nombreCategoria: string;
  miId: number;
  verPublicacionesDe: (id: number, nombre: string) => void;
}) {
  const router = useRouter();
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const leaflet = useRef<typeof L | null>(null);
  const marcadores = useRef(new Map<string, L.CircleMarker>());
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState(false);
  const ver = useRef(verPublicacionesDe);
  useEffect(() => {
    ver.current = verPublicacionesDe;
  });

  // Se crea el mapa la primera vez que se abre la pestaña
  useEffect(() => {
    if (!visible) return;
    let cancelado = false;
    (async () => {
      if (!mapa.current) {
        const modulo = await import("leaflet");
        const Lf = (modulo.default ?? modulo) as typeof L;
        if (cancelado || !caja.current) return;
        leaflet.current = Lf;
        // Sin zoom con la rueda: así la página se puede desplazar sobre el mapa
        mapa.current = Lf.map(caja.current, { scrollWheelZoom: false }).setView([12.85, -85.2], 7);
        Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "&copy; colaboradores de OpenStreetMap",
        }).addTo(mapa.current);
        mapa.current.on("click", () => mapa.current?.scrollWheelZoom.enable());
        capa.current = Lf.layerGroup().addTo(mapa.current);
      } else {
        setTimeout(() => mapa.current?.invalidateSize(), 200);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [visible]);

  useEffect(
    () => () => {
      mapa.current?.remove();
      mapa.current = null;
    },
    []
  );

  // Datos (al abrir la pestaña y al cambiar la categoría)
  useEffect(() => {
    if (!visible) return;
    let vivo = true;
    api(`/api/mapa/proveedores${categoria ? "?categoria=" + encodeURIComponent(categoria) : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error("sin datos");
        return r.json() as Promise<Datos>;
      })
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        setError(false);
      })
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [visible, categoria]);

  // Ventana de un departamento, con elementos del DOM (sin innerHTML)
  function popup(d: Departamento): HTMLElement {
    const el = (tag: string, texto?: string, clase?: string) => {
      const n = document.createElement(tag);
      if (texto !== undefined) n.textContent = texto;
      if (clase) n.className = clase;
      return n;
    };
    const raiz = el("div", undefined, "popup-prov");
    raiz.append(el("h4", `${d.departamento} · ${plural(d.proveedores.length, "proveedor", "proveedores")}`));
    const ul = el("ul");
    for (const p of d.proveedores) {
      const li = el("li");
      const fuerte = el("strong");
      const a = el("a", p.nombre, "enlace-perfil") as HTMLAnchorElement;
      a.href = `/perfil-publico?id=${Number(p.id)}`;
      a.title = `Ver el perfil de ${p.nombre}`;
      fuerte.append(a);
      const meta = el(
        "span",
        `${plural(p.ofertas, "publicación", "publicaciones")}${p.categorias.length ? " · " + p.categorias.slice(0, 3).join(", ") : ""}`
      );
      meta.style.color = "#666";
      li.append(fuerte, el("br"), meta, el("br"));
      if (p.ofertas) {
        const b = el("button", "Ver publicaciones") as HTMLButtonElement;
        b.type = "button";
        b.onclick = () => ver.current(p.id, p.nombre);
        li.append(b);
      }
      if (p.id !== miId) {
        const b = el("button", "Escribir") as HTMLButtonElement;
        b.type = "button";
        b.onclick = () => router.push(`/chat?contacto=${Number(p.id)}`);
        li.append(" ", b);
      }
      ul.append(li);
    }
    raiz.append(ul);
    return raiz;
  }

  function pintar(Lf: typeof L, m: L.Map, c: L.LayerGroup, d: Datos) {
    c.clearLayers();
    marcadores.current.clear();
    const puntos: [number, number][] = [];
    const mio = d.miUbicacion?.nombre ?? null;
    for (const dep of d.departamentos) {
      const marcador = Lf.circleMarker([dep.lat, dep.lng], {
        radius: Math.min(30, 9 + 4 * Math.sqrt(dep.proveedores.length)),
        color: "#fff",
        weight: 2,
        fillColor: dep.departamento === mio ? COLOR_MIO : COLOR_MAPA,
        fillOpacity: 0.85,
      })
        .bindPopup(() => popup(dep), { maxWidth: 280, autoPanPadding: [20, 20] })
        .bindTooltip(`${dep.departamento}: ${plural(dep.proveedores.length, "proveedor", "proveedores")}`);
      marcador.addTo(c);
      marcadores.current.set(dep.departamento, marcador);
      puntos.push([dep.lat, dep.lng]);
    }
    if (d.miUbicacion && !d.departamentos.some((x) => x.departamento === mio)) {
      Lf.circleMarker([d.miUbicacion.lat, d.miUbicacion.lng], { radius: 7, color: "#fff", weight: 2, fillColor: COLOR_MIO, fillOpacity: 0.9 })
        .bindTooltip(`Tú: ${d.miUbicacion.nombre}`)
        .addTo(c);
      puntos.push([d.miUbicacion.lat, d.miUbicacion.lng]);
    }
    if (puntos.length > 1) m.fitBounds(puntos, { padding: [40, 40], maxZoom: 9 });
    else if (puntos.length === 1) m.setView(puntos[0], 9);
    else m.setView([12.85, -85.2], 7);
  }

  // Círculos del mapa: espera a que el mapa exista
  useEffect(() => {
    if (!datos) return;
    let intentos = 0;
    const reloj = setInterval(() => {
      const Lf = leaflet.current;
      if (!Lf || !mapa.current || !capa.current) {
        if (++intentos > 50) clearInterval(reloj);
        return;
      }
      clearInterval(reloj);
      pintar(Lf, mapa.current, capa.current, datos);
    }, 100);
    return () => clearInterval(reloj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos]);

  function enfocar(nombre: string) {
    const marcador = marcadores.current.get(nombre);
    if (!marcador || !mapa.current) return;
    caja.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Sin animación: así el mapa se puede mover para que la ventana quepa entera
    mapa.current.setView(marcador.getLatLng(), 9, { animate: false });
    setTimeout(() => marcador.openPopup(), 350);
  }

  function filaProveedor(p: Proveedor) {
    const estrellas = p.totalCalificaciones ? ` · ★ ${Number(p.calificacion).toFixed(1)}` : "";
    const meta = `${plural(p.ofertas, "publicación", "publicaciones")}${estrellas}${p.especialidad ? " · " + p.especialidad : ""}`;
    return (
      <div className="prov-fila" key={p.id}>
        <span>
          <strong>
            <EnlacePerfil id={p.id} nombre={p.nombre} />
          </strong>
          <span className="prov-meta">{meta}</span>
        </span>
        <span style={{ display: "flex", gap: 4 }}>
          {p.ofertas > 0 && (
            <button type="button" className="btn-sm" onClick={() => verPublicacionesDe(p.id, p.nombre)}>
              Ver
            </button>
          )}
          {p.id !== miId && (
            <Link className="btn-sm" style={{ textDecoration: "none" }} href={`/chat?contacto=${Number(p.id)}`} aria-label={`Escribirle a ${p.nombre}`}>
              <i className="ti ti-message-circle" aria-hidden="true" />
            </Link>
          )}
        </span>
      </div>
    );
  }

  const enMapa = datos ? datos.total - datos.sinUbicacion.length : 0;

  return (
    <div id="tab-map" className="section" style={{ display: visible ? "block" : "none" }}>
      <div className="filter-bar">
        <div className="mapa-cabecera">
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-secundario)", display: "flex", alignItems: "center", gap: 6 }}>
            <i className="ti ti-map-2" style={{ fontSize: 18, color: "var(--color-principal)" }} aria-hidden="true" /> Proveedores en Nicaragua
          </div>
          <span className="mapa-resumen" id="mapa-resumen" aria-live="polite">
            {error
              ? "No se pudo cargar el mapa."
              : !datos
                ? "Cargando proveedores…"
                : datos.total
                  ? `${plural(enMapa, "proveedor", "proveedores")} en ${plural(datos.departamentos.length, "departamento", "departamentos")}`
                  : "No hay proveedores que coincidan."}
          </span>
        </div>
        <div className="leyenda-mapa">
          <span>Proveedores por departamento (el círculo crece con la cantidad)</span>
          <span className="tuyo">Tu departamento</span>
          <span style={{ display: categoria ? "" : "none" }} id="leyenda-categoria">
            {categoria ? `Solo quienes venden: ${nombreCategoria}` : ""}
          </span>
        </div>
      </div>
      <div id="mapa-interactivo" ref={caja} role="region" aria-label="Mapa de proveedores por departamento" />
      <div className="lista-mapa" id="lista-mapa" aria-label="Proveedores por departamento">
        {datos && !error && !datos.total && <p className="vacio-oscuro">No hay proveedores que vendan esa categoría todavía.</p>}
        {datos &&
          !error &&
          datos.total > 0 &&
          datos.departamentos.map((d) => (
            <section className={`depto-card${datos.miUbicacion?.nombre === d.departamento ? " mio" : ""}`} key={d.departamento}>
              <h4
                role="button"
                tabIndex={0}
                title="Ver en el mapa"
                onClick={() => enfocar(d.departamento)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    enfocar(d.departamento);
                  }
                }}
              >
                {d.departamento} <small>{plural(d.proveedores.length, "proveedor", "proveedores")}</small>
              </h4>
              {d.proveedores.map((p) => (
                filaProveedor(p)
              ))}
            </section>
          ))}
        {datos && !error && datos.total > 0 && datos.sinUbicacion.length > 0 && (
          <section className="depto-card">
            <h4>
              Sin ubicación en el mapa <small>{datos.sinUbicacion.length}</small>
            </h4>
            <p className="nota-bloque" style={{ marginBottom: 4 }}>
              Escribieron un departamento que no reconocemos.
            </p>
            {datos.sinUbicacion.map((p) => (
              filaProveedor(p)
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
