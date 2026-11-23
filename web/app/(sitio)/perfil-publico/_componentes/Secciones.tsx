// Reseñas, publicaciones y subastas del perfil público: paginadas, se piden a la API
"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { estrellasFijas, plural } from "./formato";
import FotoOferta from "@/componentes/FotoOferta";

type Pagina<T> = { datos: T[]; total: number; pagina: number; paginas: number };

const dinero = (n: number | string) =>
  `C$ ${Number(n).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaCorta = (f: string) => new Date(f).toLocaleDateString("es-NI", { day: "numeric", month: "short", year: "numeric" });

// Una foto que ya no está en el servidor: se muestra un ícono en su lugar
function Foto({ src, alt, icono }: { src?: string | null; alt: string; icono: string }) {
  const [rota, setRota] = useState(false);
  if (!src || rota) return <i className={`ti ${src ? "ti-photo-off" : icono}`} aria-hidden="true" />;
  return (
    <FotoOferta src={src} alt={alt} width={320} height={240} sizes="(max-width: 640px) 50vw, 330px" onError={() => setRota(true)} />
  );
}

function Paginacion({ datos, ir }: { datos: Pagina<unknown> | null; ir: (p: number) => void }) {
  if (!datos || datos.paginas <= 1) return <div className="paginacion" />;
  return (
    <div className="paginacion">
      <button className="btn-sm" disabled={datos.pagina <= 1} onClick={() => ir(datos.pagina - 1)}>
        <i className="ti ti-chevron-left" aria-hidden="true" /> Anterior
      </button>
      <span>
        Página <strong>{datos.pagina}</strong> de {datos.paginas}
      </span>
      <button className="btn-sm" disabled={datos.pagina >= datos.paginas} onClick={() => ir(datos.pagina + 1)}>
        Siguiente <i className="ti ti-chevron-right" aria-hidden="true" />
      </button>
    </div>
  );
}

// Pide una página y la pinta; al cambiar de página lleva la vista al inicio de la sección
function usePaginado<T>(url: (pagina: number) => string) {
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<Pagina<T> | null>(null);
  const [error, setError] = useState(false);
  const [desplazar, setDesplazar] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const urlActual = url(pagina);

  useEffect(() => {
    let vivo = true;
    fetch(urlActual)
      .then((res) => {
        if (!res.ok) throw new Error("sin datos");
        return res.json() as Promise<Pagina<T>>;
      })
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        setError(false);
        if (desplazar) ref.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [urlActual, desplazar]);

  const ir = (p: number) => {
    setDesplazar(true);
    setPagina(p);
  };
  return { datos, error, ir, ref };
}

function Lista<T>({
  estado,
  vacio,
  clase,
  pintar,
  id,
}: {
  estado: ReturnType<typeof usePaginado<T>>;
  vacio: string;
  clase: string;
  pintar: (x: T) => ReactNode;
  id: string;
}) {
  const { datos, error, ir, ref } = estado;
  return (
    <>
      <div className={clase} id={id} ref={ref} aria-live="polite">
        {error ? (
          <p className="vacio-tarjeta">No se pudo cargar esta sección.</p>
        ) : datos && !datos.datos.length ? (
          <p className="vacio-tarjeta">{vacio}</p>
        ) : (
          datos?.datos.map(pintar)
        )}
      </div>
      <Paginacion datos={datos} ir={ir} />
    </>
  );
}

type Resena = { id?: number; autor: string; puntuacion: number; fecha: string; comentario?: string | null };

export function Resenas({ perfilId }: { perfilId: number }) {
  const estado = usePaginado<Resena>((p) => `/api/usuarios/${perfilId}/resenas?pagina=${p}&porPagina=5`);
  return (
    <Lista
      estado={estado}
      id="lista-resenas"
      clase="resenas"
      vacio="Todavía no hay reseñas."
      pintar={(c) => (
        <article className="resena" key={`${c.id ?? ""}${c.fecha}${c.autor}`}>
          <div className="resena-cabeza">
            <span>
              <strong>{c.autor}</strong> ·{" "}
              <span className="estrellas-fijas" aria-label={`${c.puntuacion} de 5 estrellas`}>
                {estrellasFijas(c.puntuacion)}
              </span>
            </span>
            <time dateTime={c.fecha}>{fechaCorta(c.fecha)}</time>
          </div>
          {c.comentario ? <p>{c.comentario}</p> : <p className="sin-comentario">Calificó sin comentario.</p>}
        </article>
      )}
    />
  );
}

type Oferta = {
  OfertaID: number;
  Fotos?: string[];
  TituloMaterial: string;
  NombreCategoria: string;
  Precio: number;
  UnidadMedida: string;
};

export function Publicaciones({ perfilId }: { perfilId: number }) {
  const estado = usePaginado<Oferta>((p) => `/api/ofertas?proveedorId=${perfilId}&pagina=${p}&porPagina=6`);
  return (
    <section className="tarjeta" aria-labelledby="titulo-publicaciones">
      <h2 id="titulo-publicaciones">
        <i className="ti ti-package" style={{ color: "var(--color-principal)" }} aria-hidden="true" /> Publicaciones{" "}
        <small id="total-publicaciones">
          {estado.datos?.total ? plural(estado.datos.total, "publicación", "publicaciones") : ""}
        </small>
      </h2>
      <Lista
        estado={estado}
        id="lista-publicaciones"
        clase="rejilla"
        vacio="No tiene publicaciones por ahora."
        pintar={(o) => (
          <Link className="mini" href={`/mercado?oferta=${Number(o.OfertaID)}`} key={o.OfertaID}>
            <div className="mini-foto">
              <Foto src={o.Fotos?.[0]} alt={o.TituloMaterial} icono="ti-package" />
            </div>
            <div className="mini-cuerpo">
              <span className="mini-nota">{o.NombreCategoria}</span>
              <h3>{o.TituloMaterial}</h3>
              <div className="mini-precio">
                {dinero(o.Precio)} <small>{o.UnidadMedida}</small>
              </div>
            </div>
          </Link>
        )}
      />
    </section>
  );
}

type Subasta = {
  SubastaID: number;
  TituloLote: string;
  TotalPujas: number;
  Foto?: string | null;
  NombreCategoria?: string | null;
  PrecioActual: number;
  FechaFin: string;
};

export function Subastas({ perfilId }: { perfilId: number }) {
  const estado = usePaginado<Subasta>((p) => `/api/subastas?proveedorId=${perfilId}&pagina=${p}&porPagina=6`);
  return (
    <section className="tarjeta" aria-labelledby="titulo-subastas" style={{ borderTopColor: "var(--color-terciario)" }}>
      <h2 id="titulo-subastas">
        <i className="ti ti-gavel" style={{ color: "var(--color-terciario)" }} aria-hidden="true" /> Subastas activas{" "}
        <small id="total-subastas">{estado.datos?.total ? plural(estado.datos.total, "subasta", "subastas") : ""}</small>
      </h2>
      <Lista
        estado={estado}
        id="lista-subastas"
        clase="rejilla"
        vacio="No tiene subastas abiertas en este momento."
        pintar={(s) => {
          const lote = String(s.TituloLote || "").replace(/^Lote Subasta:\s*/i, "") || s.TituloLote;
          return (
            <Link className="mini" href="/mercado#tab-auctions" key={s.SubastaID}>
              <div className="mini-foto">
                <Foto src={s.Foto} alt={lote} icono="ti-gavel" />
              </div>
              <div className="mini-cuerpo">
                <span className="mini-nota">
                  {s.NombreCategoria || "Subasta"} · {plural(Number(s.TotalPujas) || 0, "puja", "pujas")}
                </span>
                <h3>{lote}</h3>
                <div className="mini-precio">
                  {dinero(s.PrecioActual)} <small>cierra el {fechaCorta(s.FechaFin)}</small>
                </div>
              </div>
            </Link>
          );
        }}
      />
    </section>
  );
}

// En el celular abre el menú de compartir del sistema; en la computadora copia el enlace
export function BotonCompartir({ perfilId, nombre }: { perfilId: number; nombre: string }) {
  const [copiado, setCopiado] = useState(false);
  async function compartir() {
    const url = `${window.location.origin}${window.location.pathname}?id=${perfilId}`;
    const datos = { title: `${nombre} en EntreLazados`, text: `Mira el perfil de ${nombre} en EntreLazados`, url };
    try {
      if (navigator.share) return await navigator.share(datos);
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // cerró el menú de compartir
      window.prompt("Copia este enlace:", url);
    }
  }
  return (
    <button type="button" className="btn-sm" onClick={compartir}>
      {copiado ? (
        <>
          <i className="ti ti-check" aria-hidden="true" /> Enlace copiado
        </>
      ) : (
        <>
          <i className="ti ti-share" aria-hidden="true" /> Compartir
        </>
      )}
    </button>
  );
}
