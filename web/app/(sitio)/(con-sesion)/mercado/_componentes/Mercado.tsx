// ==========================================================================
// MERCADO (antes mercado.html + mercado.js): buscador, pestañas, ofertas, subastas
// con pujas en vivo, mapa, favoritos y alertas, y los formularios de publicar.
//   ?q= &categoria= (ID o texto viejo) &radio=   filtros del buscador (desde /inicio)
//   ?oferta=ID (notificación) o ?proveedor=ID&nombre= (perfil o mapa)   filtro fijo
//   #tab-auctions, #tab-favorites, #tab-map   abre esa pestaña (enlaces de las notificaciones)
// ==========================================================================
"use client";
/* eslint-disable @next/next/no-img-element -- fotos subidas por los proveedores (Blob) */
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Cabecera from "@/componentes/sitio/Cabecera";
import { useEventoTiempoReal, useSitio } from "@/componentes/sitio/ProveedorSitio";
import { api, conJSON } from "@/lib/cliente/api";
import { buscarCategoriaPorTexto, useCategorias } from "@/lib/cliente/categorias";
import { Paginacion, TarjetaOferta } from "./Comunes";
import Favoritos, { enviarAlerta, type ManejoFavoritos } from "./Favoritos";
import Mapa from "./Mapa";
import ModalOferta from "./ModalOferta";
import ModalSubasta from "./ModalSubasta";
import SubBarra from "./SubBarra";
import { tiempoRestante, type FiltroFijo, type Oferta, type Pagina, type Pestana, type Subasta } from "./tipos";

const POR_PAGINA_OFERTAS = 10;
const POR_PAGINA_SUBASTAS = 8;
const PESTANAS: [Pestana, string, string][] = [
  ["listings", "ti-building-store", "Ofertas Directas"],
  ["auctions", "ti-gavel", "Subastas Activas"],
  ["map", "ti-map-2", "Mapa de Proveedores"],
  ["favorites", "ti-heart", "Favoritos y Alertas"],
];
const DE_ANCLA: Record<string, Pestana> = {
  "#tab-auctions": "auctions",
  "#tab-favorites": "favorites",
  "#tab-map": "map",
};

export default function Mercado() {
  const { usuario, conectado } = useSitio();
  const miId = usuario?.id ?? 0;
  const miRol = (usuario?.rol || "").toLowerCase().trim();
  const esAdmin = miRol === "administrador" || miRol === "admin";
  const puedePublicar = miRol === "proveedor" || esAdmin;
  const params = useSearchParams();
  const categorias = useCategorias();

  // ---------------------------------------------------------------- FILTROS
  const [texto, setTexto] = useState(() => params.get("q") ?? "");
  const [categoria, setCategoria] = useState<string | null>(null); // null hasta tener las categorías
  const [km, setKm] = useState(() => Number(params.get("radio")) || 30);
  const [filtros, setFiltros] = useState<{
    q: string;
    categoria: string;
    km: number;
  } | null>(null);
  const [filtroFijo, setFiltroFijo] = useState<FiltroFijo>(() => {
    const oferta = parseInt(params.get("oferta") ?? "", 10);
    const proveedor = parseInt(params.get("proveedor") ?? "", 10);
    if (oferta > 0)
      return {
        tipo: "oferta",
        id: oferta,
        texto: "Mostrando la publicación del aviso que abriste.",
      };
    if (proveedor > 0)
      return {
        tipo: "proveedor",
        id: proveedor,
        texto: `Mostrando las publicaciones de ${params.get("nombre") || "este proveedor"}.`,
      };
    return null;
  });
  const [pestana, setPestana] = useState<Pestana>("listings");

  // ?categoria= puede traer el ID o, en enlaces viejos, un texto como "Cuero Vacuno"
  useEffect(() => {
    if (!categorias || categoria !== null) return;
    const param = params.get("categoria");
    let elegida = "todos";
    if (param) {
      if (categorias.some((c) => String(c.CategoriaID) === param)) elegida = param;
      else elegida = String(buscarCategoriaPorTexto(categorias, param) ?? "todos");
    }
    const t = setTimeout(() => {
      setCategoria(elegida);
      setFiltros({ q: texto.trim(), categoria: elegida, km });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorias]);

  // Al cambiar un filtro se vuelve a pedir la página 1 (con una pequeña espera para no
  // hacer una petición por cada movimiento del control de distancia)
  const espera = useRef<ReturnType<typeof setTimeout>>(undefined);
  function aplicarFiltros(cambios: Partial<{ q: string; categoria: string; km: number }>) {
    clearTimeout(espera.current);
    espera.current = setTimeout(() => {
      setFiltros({
        q: texto.trim(),
        categoria: categoria ?? "todos",
        km,
        ...cambios,
      });
      setPaginaOfertas(1);
      setPaginaSubastas(1);
    }, 250);
  }

  const busqueda = useCallback(() => {
    const p = new URLSearchParams();
    if (filtros?.q) p.set("q", filtros.q);
    if (filtros?.categoria && filtros.categoria !== "todos") p.set("categoria", filtros.categoria);
    return p;
  }, [filtros]);

  // ---------------------------------------------------------------- FAVORITOS
  const [favoritosIds, setFavoritosIds] = useState<Set<number>>(new Set());
  const [favOcupado, setFavOcupado] = useState<number | null>(null);
  const favoritosRef = useRef<ManejoFavoritos>(null);
  useEffect(() => {
    let vivo = true;
    api("/api/favoritos/ids")
      .then((r) => (r.ok ? r.json() : []))
      .then((ids: number[]) => vivo && setFavoritosIds(new Set(ids)))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  async function alternarFavorito(id: number) {
    const guardada = favoritosIds.has(id);
    setFavOcupado(id);
    try {
      const res = await api(`/api/favoritos/${id}`, {
        method: guardada ? "DELETE" : "POST",
      });
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) return alert(d.message || "No se pudo actualizar tus favoritos.");
      setFavoritosIds((s) => {
        const n = new Set(s);
        if (guardada) n.delete(id);
        else n.add(id);
        return n;
      });
      // En la pestaña de favoritos la siguiente publicación sube a ocupar su lugar
      if (guardada && pestana === "favorites") favoritosRef.current?.recargar();
    } catch {
      alert("Error al conectar con el servidor.");
    } finally {
      setFavOcupado(null);
    }
  }

  // ---------------------------------------------------------------- OFERTAS
  const [ofertas, setOfertas] = useState<Pagina<Oferta> | null>(null);
  const [errorOfertas, setErrorOfertas] = useState(false);
  const [paginaOfertas, setPaginaOfertas] = useState(1);
  const [versionOfertas, setVersionOfertas] = useState(0);
  const [conocidas, setConocidas] = useState<Oferta[]>([]); // para editar desde ofertas o favoritos
  const desplazarOfertas = useRef(false);
  const tabOfertas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filtros) return;
    let vivo = true;
    // Con un filtro fijo (una publicación o un proveedor) se ignoran el buscador y la distancia
    const p = filtroFijo ? new URLSearchParams() : busqueda();
    p.set("pagina", String(paginaOfertas));
    p.set("porPagina", String(POR_PAGINA_OFERTAS));
    if (filtroFijo) p.set(filtroFijo.tipo === "oferta" ? "id" : "proveedorId", String(filtroFijo.id));
    else p.set("maxKm", String(filtros.km));
    api(`/api/ofertas?${p}`)
      .then((r) => {
        if (!r.ok) throw new Error("Error backend");
        return r.json() as Promise<Pagina<Oferta>>;
      })
      .then((d) => {
        if (!vivo) return;
        // Se borró lo último de la última página: se muestra la anterior
        if (d.datos.length === 0 && d.total > 0 && paginaOfertas > 1) return setPaginaOfertas(d.paginas);
        setOfertas(d);
        setErrorOfertas(false);
        setConocidas((c) => [...c.filter((o) => !d.datos.some((x) => x.OfertaID === o.OfertaID)), ...d.datos]);
        if (desplazarOfertas.current) tabOfertas.current?.scrollIntoView({ behavior: "smooth" });
        desplazarOfertas.current = false;
      })
      .catch(() => vivo && setErrorOfertas(true));
    return () => {
      vivo = false;
    };
  }, [filtros, filtroFijo, paginaOfertas, versionOfertas, busqueda]);

  async function eliminarOferta(id: number) {
    if (!confirm("¿Estás seguro de que deseas eliminar esta oferta?")) return;
    try {
      const res = await api(`/api/ofertas/${id}`, conJSON("DELETE", { proveedorId: miId }));
      const r = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        alert(r.message || "Oferta eliminada exitosamente.");
        setVersionOfertas((v) => v + 1);
        setVersionSubastas((v) => v + 1);
      } else alert(r.message);
    } catch {
      alert("Error al conectar con el servidor.");
    }
  }

  function verPublicacionesDe(id: number, nombre: string) {
    setFiltroFijo({
      tipo: "proveedor",
      id: Number(id),
      texto: `Mostrando las publicaciones de ${nombre || "este proveedor"}.`,
    });
    setPestana("listings");
    desplazarOfertas.current = true;
    setPaginaOfertas(1);
  }

  function quitarFiltroFijo() {
    setFiltroFijo(null);
    // Se quita ?oferta= o ?proveedor= de la dirección para que al recargar se vean todas
    const url = new URL(window.location.href);
    ["oferta", "proveedor", "nombre"].forEach((p) => url.searchParams.delete(p));
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    setPaginaOfertas(1);
  }

  // ---------------------------------------------------------------- SUBASTAS
  const [subastas, setSubastas] = useState<Pagina<Subasta> | null>(null);
  const [errorSubastas, setErrorSubastas] = useState(false);
  const [paginaSubastas, setPaginaSubastas] = useState(1);
  const [versionSubastas, setVersionSubastas] = useState(0);
  const [pujas, setPujas] = useState<Record<number, string>>({});
  const [enVivo, setEnVivo] = useState<Record<number, { precio: number; total: number; vez: number }>>({});
  const desplazarSubastas = useRef(false);
  const tabSubastas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filtros) return;
    let vivo = true;
    const p = busqueda();
    p.set("pagina", String(paginaSubastas));
    p.set("porPagina", String(POR_PAGINA_SUBASTAS));
    api(`/api/subastas?${p}`)
      .then((r) => {
        if (!r.ok) throw new Error("Error consultando subastas");
        return r.json() as Promise<Pagina<Subasta>>;
      })
      .then((d) => {
        if (!vivo) return;
        if (d.datos.length === 0 && d.total > 0 && paginaSubastas > 1) return setPaginaSubastas(d.paginas);
        setSubastas(d);
        setEnVivo({});
        setErrorSubastas(false);
        if (desplazarSubastas.current) tabSubastas.current?.scrollIntoView({ behavior: "smooth" });
        desplazarSubastas.current = false;
      })
      .catch(() => vivo && setErrorSubastas(true));
    return () => {
      vivo = false;
    };
  }, [filtros, paginaSubastas, versionSubastas, busqueda]);

  async function pujar(s: Subasta) {
    // El precio pudo subir mientras tanto (tiempo real): se usa el que muestra la tarjeta
    const precioActual = enVivo[s.SubastaID]?.precio ?? Number(s.PrecioActual);
    const monto = parseFloat(pujas[s.SubastaID] ?? "");
    if (miRol === "proveedor") return alert("Los proveedores no pueden realizar pujas.");
    if (!monto || monto <= precioActual)
      return alert(`Tu puja debe ser mayor al precio actual de C$${precioActual.toLocaleString()}`);
    try {
      const res = await api(
        "/api/pujas",
        conJSON("POST", {
          subastaId: s.SubastaID,
          emprendedorId: miId,
          montoPuja: monto,
        }),
      );
      const r = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        alert(r.message);
        setPujas((p) => ({ ...p, [s.SubastaID]: "" }));
        setVersionSubastas((v) => v + 1);
      } else alert("Error: " + r.message);
    } catch {
      alert("No se pudo procesar la puja con el servidor.");
    }
  }

  // TIEMPO REAL: cuando alguien puja, el precio de la tarjeta cambia solo
  useEventoTiempoReal<{
    subastaId: number;
    precioActual: number;
    totalPujas: number;
  }>("puja:nueva", (d) => {
    if (!d?.subastaId) return;
    setEnVivo((v) => ({
      ...v,
      [d.subastaId]: {
        precio: Number(d.precioActual),
        total: Number(d.totalPujas),
        vez: (v[d.subastaId]?.vez ?? 0) + 1,
      },
    }));
  });
  // Si se crea, cancela o cierra una subasta, la lista se recarga (no mientras alguien escribe su puja)
  const recargaSubastas = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEventoTiempoReal("subastas:cambio", () => {
    clearTimeout(recargaSubastas.current);
    const recargar = () => {
      const activo = document.activeElement as HTMLInputElement | null;
      if (activo?.classList.contains("bid-input") && activo.value) {
        recargaSubastas.current = setTimeout(recargar, 3000);
        return;
      }
      setVersionSubastas((v) => v + 1);
    };
    recargaSubastas.current = setTimeout(recargar, 800);
  });

  // ---------------------------------------------------------------- PESTAÑAS
  function cambiarPestana(nueva: Pestana) {
    setPestana(nueva);
    if (nueva === "listings") setVersionOfertas((v) => v + 1);
    if (nueva === "auctions") setVersionSubastas((v) => v + 1);
    if (nueva === "favorites") favoritosRef.current?.recargar();
  }
  // Las notificaciones llevan a /mercado#tab-auctions: se abre esa pestaña
  useEffect(() => {
    const abrir = () => {
      const p = DE_ANCLA[window.location.hash];
      if (p) setPestana(p);
    };
    const t = setTimeout(abrir, 0);
    window.addEventListener("hashchange", abrir);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", abrir);
    };
  }, []);

  // ---------------------------------------------------------------- BUSCADOR Y ALERTAS
  function buscar(e: FormEvent) {
    e.preventDefault();
    aplicarFiltros({});
  }

  // "Avísame de nuevas": crea una alerta con lo que está escrito en el buscador
  async function crearAlertaDeBusqueda() {
    const q = texto.trim();
    if (!q && (!categoria || categoria === "todos")) {
      alert('Escribe qué buscas o elige una categoría en el buscador, o crea la alerta desde "Favoritos y Alertas".');
      cambiarPestana("favorites");
      favoritosRef.current?.enfocarAlerta();
      return;
    }
    try {
      alert(
        (
          await enviarAlerta({
            palabraClave: q,
            categoriaId: categoria === "todos" ? null : categoria,
          })
        ).message,
      );
    } catch {
      alert("Error al conectar con el servidor.");
    }
  }

  // ---------------------------------------------------------------- MODALES
  const [modalOferta, setModalOferta] = useState<{
    abierto: boolean;
    editando: Oferta | null;
  }>({ abierto: false, editando: null });
  const [modalSubasta, setModalSubasta] = useState(false);

  const tarjeta = (o: Oferta) => (
    <TarjetaOferta
      key={o.OfertaID}
      oferta={o}
      miId={miId}
      miRol={miRol}
      guardada={favoritosIds.has(Number(o.OfertaID))}
      ocupada={favOcupado === Number(o.OfertaID)}
      alFavorito={alternarFavorito}
      alEditar={(x) =>
        setModalOferta({
          abierto: true,
          editando: conocidas.find((c) => c.OfertaID === x.OfertaID) ?? x,
        })
      }
      alEliminar={eliminarOferta}
    />
  );

  const nombreCategoria = categorias?.find((c) => String(c.CategoriaID) === filtros?.categoria)?.NombreCategoria ?? "";
  const hayBusqueda = [...busqueda().keys()].length > 0;

  return (
    <>
      <Cabecera>
        <form id="searchForm" className="search-bar" onSubmit={buscar} role="search">
          <select
            id="searchCategory"
            className="search-category"
            aria-label="Categoría"
            value={categoria ?? "todos"}
            onChange={(e) => {
              setCategoria(e.target.value);
              aplicarFiltros({ categoria: e.target.value });
            }}
          >
            <option value="todos">Todos los insumos</option>
            {categorias?.map((c) => (
              <option key={c.CategoriaID} value={String(c.CategoriaID)}>
                {c.NombreCategoria}
              </option>
            ))}
          </select>
          <input
            type="text"
            id="searchInput"
            className="search-input"
            aria-label="Buscar materiales"
            placeholder="Buscar cuero vacuno, hebillas, remaches, suelas..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <button type="submit" className="search-btn" aria-label="Buscar">
            <i className="ti ti-search" aria-hidden="true" />
          </button>
        </form>
      </Cabecera>

      <SubBarra />

      <span id="contenido-principal" tabIndex={-1} />
      <main id="app">
        <div className="tab-bar" role="tablist" aria-label="Secciones del mercado">
          {PESTANAS.map(([id, icono, nombre]) => (
            <button
              key={id}
              className={`tab${pestana === id ? " active" : ""}`}
              role="tab"
              aria-selected={pestana === id}
              onClick={() => cambiarPestana(id)}
            >
              <i className={`ti ${icono}`} style={{ marginRight: 4 }} aria-hidden="true" /> {nombre}
            </button>
          ))}
        </div>

        {/* OFERTAS */}
        <div
          id="tab-listings"
          className="section"
          ref={tabOfertas}
          style={{ display: pestana === "listings" ? "block" : "none" }}
        >
          <div className="filter-bar">
            <div
              className="filter-row"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label htmlFor="range-km">
                  <i className="ti ti-map-pin" style={{ fontSize: 16, color: "var(--color-principal)" }} aria-hidden="true" />{" "}
                  Radio de Cercanía:
                </label>
                <input
                  type="range"
                  id="range-km"
                  min={5}
                  max={200}
                  step={5}
                  value={km}
                  aria-describedby="range-val"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setKm(v);
                    aplicarFiltros({ km: v });
                  }}
                />
                <span className="range-val" id="range-val">
                  {km}km
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="btn-sm"
                  onClick={crearAlertaDeBusqueda}
                  title="Te avisamos cuando publiquen algo con el texto y la categoría que buscaste"
                >
                  <i className="ti ti-bell-plus" aria-hidden="true" /> Avísame de nuevas
                </button>
                {puedePublicar && (
                  <button
                    id="btn-publicar-modal"
                    className="btn-primary"
                    style={{ display: "inline-flex" }}
                    onClick={() => setModalOferta({ abierto: true, editando: null })}
                  >
                    <i className="ti ti-plus" aria-hidden="true" /> Publicar Oferta
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="aviso-filtro" id="aviso-filtro" role="status" hidden={!filtroFijo}>
            <i className="ti ti-filter" aria-hidden="true" /> <span id="texto-aviso-filtro">{filtroFijo?.texto}</span>
            <button type="button" className="btn-sm" onClick={quitarFiltroFijo}>
              Ver todas las publicaciones
            </button>
          </div>
          <div className="listings" id="contenedor-ofertas">
            {errorOfertas ? (
              <p style={{ textAlign: "center", color: "#c92a2a", padding: 20 }}>Error al conectar con la base de datos.</p>
            ) : !ofertas ? (
              <p
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  padding: 20,
                }}
              >
                Cargando materiales disponibles...
              </p>
            ) : !ofertas.datos.length ? (
              <p className="vacio-oscuro">
                <i className="ti ti-info-circle" aria-hidden="true" />{" "}
                {filtroFijo
                  ? filtroFijo.tipo === "oferta"
                    ? "Esa publicación ya no está disponible."
                    : "Este proveedor no tiene publicaciones por ahora."
                  : `No hay ofertas disponibles que coincidan con tus filtros dentro de un radio de ${km}km.`}
              </p>
            ) : (
              ofertas.datos.map(tarjeta)
            )}
          </div>
          <div className="paginacion" id="paginacion-ofertas">
            {!errorOfertas && (
              <Paginacion
                datos={ofertas}
                ir={(p) => {
                  desplazarOfertas.current = true;
                  setPaginaOfertas(p);
                }}
              />
            )}
          </div>
        </div>

        {/* SUBASTAS */}
        <div
          id="tab-auctions"
          className="section"
          ref={tabSubastas}
          style={{ display: pestana === "auctions" ? "block" : "none" }}
        >
          <div
            className="filter-bar"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTopColor: "var(--color-terciario)",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--color-secundario)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <i className="ti ti-gavel" style={{ fontSize: 18, color: "var(--color-terciario)" }} aria-hidden="true" /> Lotes en
              Subasta Pública
              <span
                className="en-vivo"
                id="indicador-en-vivo"
                title="Los precios se actualizan solos cuando alguien puja"
                hidden={!conectado}
              >
                En vivo
              </span>
            </div>
            {puedePublicar && (
              <button
                id="btn-subasta-modal"
                className="btn-primary"
                style={{
                  display: "inline-flex",
                  backgroundColor: "var(--color-terciario)",
                }}
                onClick={() => setModalSubasta(true)}
              >
                <i className="ti ti-plus" aria-hidden="true" /> Crear Subasta
              </button>
            )}
          </div>
          <div id="contenedor-subastas">
            {errorSubastas ? (
              <p style={{ textAlign: "center", color: "#c92a2a", padding: 20 }}>No se pudieron cargar las subastas.</p>
            ) : !subastas ? (
              <p
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  padding: 20,
                }}
              >
                Cargando subastas activas...
              </p>
            ) : !subastas.datos.length ? (
              <p
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  marginTop: 20,
                }}
              >
                {hayBusqueda
                  ? "No hay subastas activas que coincidan con tu búsqueda."
                  : "No hay lotes en subasta activa actualmente."}
              </p>
            ) : (
              subastas.datos.map((s) => {
                const esMia = Number(s.ProveedorID) === miId;
                const bloqueada = miRol === "proveedor" || esMia;
                // En la base se guardan como "Lote Subasta: <material>"; en la tarjeta basta el material
                const lote = String(s.TituloLote || "").replace(/^Lote Subasta:\s*/i, "") || s.TituloLote;
                const tiempo = tiempoRestante(s.FechaFin);
                const vivo = enVivo[s.SubastaID];
                const precio = vivo?.precio ?? Number(s.PrecioActual);
                const total = vivo?.total ?? (Number(s.TotalPujas) || 0);
                return (
                  <div className="auction-card" key={s.SubastaID}>
                    <div className="auction-top">
                      <div className="listing-avatar">
                        {s.Foto ? (
                          <img src={s.Foto} alt={lote} loading="lazy" />
                        ) : (
                          <i className="ti ti-gavel" aria-hidden="true" />
                        )}
                      </div>
                      <div className="auction-header">
                        <div>
                          <div className="auction-title">
                            {lote}{" "}
                            {esMia && (
                              <span
                                style={{
                                  color: "var(--color-principal)",
                                  fontSize: 12,
                                }}
                              >
                                (Tu Lote)
                              </span>
                            )}
                          </div>
                          <div className="auction-sub">
                            {s.NombreCategoria && <span className="badge badge-mat">{s.NombreCategoria}</span>}
                            <span className="badge badge-mat" id={`subasta-pujas-${s.SubastaID}`}>
                              <i className="ti ti-hammer" style={{ fontSize: 10 }} aria-hidden="true" /> {total} puja
                              {total === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                        <div
                          className={`auction-timer${tiempo.pronto ? " pronto" : ""}`}
                          title={`Cierra el ${new Date(s.FechaFin).toLocaleString("es-NI")}`}
                        >
                          <i className="ti ti-clock" aria-hidden="true" /> {tiempo.texto}
                        </div>
                      </div>
                    </div>
                    <div className="auction-body">
                      <div className="bid-track">
                        <div className="bid-row">
                          <span className="bid-label">Precio base: C$ {parseFloat(String(s.PrecioBase)).toLocaleString()}</span>
                          <div
                            key={vivo?.vez ?? 0}
                            className={`bid-amount${vivo ? " recien-pujado" : ""}`}
                            id={`subasta-val-${s.SubastaID}`}
                            data-precio={precio}
                            aria-live="polite"
                          >
                            C$ {precio.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="bid-input-row">
                        <input
                          className="bid-input"
                          type="number"
                          placeholder="Tu oferta en C$"
                          aria-label={`Tu oferta para ${lote}`}
                          id={`subasta-input-${s.SubastaID}`}
                          disabled={bloqueada}
                          style={bloqueada ? { background: "#f4f1ea", cursor: "not-allowed" } : undefined}
                          value={pujas[s.SubastaID] ?? ""}
                          onChange={(e) =>
                            setPujas((p) => ({
                              ...p,
                              [s.SubastaID]: e.target.value,
                            }))
                          }
                        />
                        <button
                          className="btn-sm cta"
                          style={
                            bloqueada
                              ? {
                                  backgroundColor: "#b0a8a0",
                                  cursor: "not-allowed",
                                }
                              : undefined
                          }
                          disabled={bloqueada}
                          onClick={() => pujar(s)}
                        >
                          {bloqueada ? "Bloqueado" : "Pujar"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="paginacion" id="paginacion-subastas">
            {!errorSubastas && (
              <Paginacion
                datos={subastas}
                ir={(p) => {
                  desplazarSubastas.current = true;
                  setPaginaSubastas(p);
                }}
              />
            )}
          </div>
        </div>

        <Mapa
          visible={pestana === "map"}
          categoria={filtros?.categoria && filtros.categoria !== "todos" ? filtros.categoria : ""}
          nombreCategoria={nombreCategoria}
          miId={miId}
          verPublicacionesDe={verPublicacionesDe}
        />

        <Favoritos
          ref={favoritosRef}
          visible={pestana === "favorites"}
          categorias={categorias ?? []}
          tarjeta={tarjeta}
          alCargar={(lista) => {
            setFavoritosIds((s) => new Set([...s, ...lista.map((o) => Number(o.OfertaID))]));
            setConocidas((c) => [...c.filter((o) => !lista.some((x) => x.OfertaID === o.OfertaID)), ...lista]);
          }}
        />
      </main>

      {modalOferta.abierto && (
        <ModalOferta
          key={modalOferta.editando?.OfertaID ?? "nueva"}
          editando={modalOferta.editando}
          categorias={categorias ?? []}
          alCerrar={() => setModalOferta({ abierto: false, editando: null })}
          alGuardar={(editada) => {
            setModalOferta({ abierto: false, editando: null });
            if (!editada) setPaginaOfertas(1);
            setVersionOfertas((v) => v + 1);
            setVersionSubastas((v) => v + 1);
            if (pestana === "favorites") favoritosRef.current?.recargar();
          }}
        />
      )}
      {puedePublicar && (
        <ModalSubasta
          abierto={modalSubasta}
          miId={miId}
          categorias={categorias ?? []}
          alCerrar={() => setModalSubasta(false)}
          alCrear={() => {
            setModalSubasta(false);
            setVersionSubastas((v) => v + 1);
          }}
        />
      )}
    </>
  );
}
