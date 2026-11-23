// Piezas que comparten las pestañas del Mercado: paginación, enlace al perfil, estrellas
// y la tarjeta de una publicación (lista de ofertas y favoritos)
"use client";
import Link from "next/link";
import type { Oferta, Pagina } from "./tipos";
import FotoOferta from "@/componentes/FotoOferta";

export function Paginacion({ datos, ir }: { datos: Pagina<unknown> | null; ir: (p: number) => void }) {
  if (!datos || datos.total === 0 || datos.paginas <= 1) return null;
  return (
    <>
      <button className="btn-sm" disabled={datos.pagina <= 1} onClick={() => ir(datos.pagina - 1)}>
        <i className="ti ti-chevron-left" aria-hidden="true" /> Anterior
      </button>
      <span>
        Página <strong>{datos.pagina}</strong> de {datos.paginas} · {datos.total} resultado{datos.total === 1 ? "" : "s"}
      </span>
      <button className="btn-sm" disabled={datos.pagina >= datos.paginas} onClick={() => ir(datos.pagina + 1)}>
        Siguiente <i className="ti ti-chevron-right" aria-hidden="true" />
      </button>
    </>
  );
}

// Nombre del proveedor que lleva a su perfil público
export const EnlacePerfil = ({ id, nombre }: { id: number; nombre: string }) => (
  <Link className="enlace-perfil" href={`/perfil-publico?id=${Number(id)}`} title={`Ver el perfil de ${nombre}`}>
    {nombre}
  </Link>
);

// "★ 4.5 (3)" o "Sin calificaciones"
export function Estrellas({ promedio, total }: { promedio?: number | null; total?: number | null }) {
  if (!total) return <span className="sin-calificar">Sin calificaciones</span>;
  return (
    <span
      className="estrellas"
      title={`${promedio} de 5 en ${total} trato${total === 1 ? "" : "s"} completado${total === 1 ? "" : "s"}`}
    >
      <i className="ti ti-star-filled" aria-hidden="true" /> {Number(promedio).toFixed(1)} <small>({total})</small>
    </span>
  );
}

export function TarjetaOferta({
  oferta,
  miId,
  miRol,
  guardada,
  ocupada,
  alFavorito,
  alEditar,
  alEliminar,
}: {
  oferta: Oferta;
  miId: number;
  miRol: string;
  guardada: boolean;
  ocupada: boolean;
  alFavorito: (id: number) => void;
  alEditar: (o: Oferta) => void;
  alEliminar: (id: number) => void;
}) {
  const esAdmin = miRol === "administrador" || miRol === "admin";
  const iconoCat = (oferta.NombreCategoria || "").toLowerCase().includes("cuero") ? "ti-cow" : "ti-shoe";
  const fotos = oferta.Fotos ?? [];
  const esDueno = miId === Number(oferta.ProveedorID);
  const id = Number(oferta.OfertaID);
  const textoFav = guardada ? "Quitar de favoritos" : "Guardar en favoritos";

  return (
    <article className="listing-card" data-oferta={id}>
      <div className="listing-top">
        <div className="listing-avatar">
          {fotos.length ? (
            <FotoOferta src={fotos[0]} alt={`Foto de ${oferta.TituloMaterial}`} width={60} height={60} sizes="60px" />
          ) : (
            <i className={`ti ${iconoCat}`} aria-hidden="true" />
          )}
        </div>
        <div className="listing-info">
          <h3 className="listing-name">{oferta.TituloMaterial}</h3>
          <div className="listing-sub">
            <EnlacePerfil id={oferta.ProveedorID} nombre={oferta.NombreProveedor || "Proveedor local"} /> ·{" "}
            <Estrellas promedio={oferta.CalificacionProveedor} total={oferta.TotalCalificaciones} /> · Ubicado a{" "}
            {Number(oferta.DistanciaSimuladaKm) || 0} km
          </div>
          <div className="listing-badges">
            <span className="badge badge-verified">
              <i className="ti ti-shield-check" style={{ fontSize: 10 }} aria-hidden="true" /> Verificado
            </span>
            <span className="badge badge-mat">{oferta.NombreCategoria}</span>
            {fotos.length > 0 && (
              <span className="badge badge-mat">
                <i className="ti ti-photo" aria-hidden="true" /> {fotos.length} foto(s)
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="listing-price">C$ {parseFloat(String(oferta.Precio)).toFixed(2)}</div>
          <div className="listing-punit">{oferta.UnidadMedida}</div>
        </div>
      </div>
      {oferta.Descripcion && <p className="listing-desc">{oferta.Descripcion}</p>}
      <div className="listing-bottom" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* El corazón: no se puede guardar una publicación propia */}
        {!esDueno && (
          <button
            type="button"
            className="btn-fav"
            data-fav={id}
            aria-pressed={guardada}
            aria-label={`${textoFav}: ${oferta.TituloMaterial}`}
            title={textoFav}
            disabled={ocupada}
            onClick={() => alFavorito(id)}
          >
            <i className={`ti ${guardada ? "ti-heart-filled" : "ti-heart"}`} aria-hidden="true" />
          </button>
        )}
        {/* "Contactar Proveedor" abre el chat con quien publicó (no con uno mismo) */}
        {esDueno ? (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            <i className="ti ti-user-check" aria-hidden="true" /> Tu publicación
          </span>
        ) : (
          <Link
            href={`/chat?contacto=${Number(oferta.ProveedorID)}`}
            className="btn-sm"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <i className="ti ti-message-circle" aria-hidden="true" /> Contactar Proveedor
          </Link>
        )}
        {/* Editar y eliminar: el dueño de la publicación y el administrador */}
        {esDueno && (miRol === "proveedor" || esAdmin) ? (
          <>
            <button className="btn-sm" style={{ marginLeft: "auto" }} onClick={() => alEditar(oferta)}>
              <i className="ti ti-pencil" aria-hidden="true" /> Editar
            </button>
            <button className="btn-sm" style={{ backgroundColor: "#c92a2a", color: "white", border: "none" }} onClick={() => alEliminar(id)}>
              <i className="ti ti-trash" aria-hidden="true" /> Eliminar
            </button>
          </>
        ) : esAdmin ? (
          <>
            <button className="btn-sm" style={{ marginLeft: "auto" }} onClick={() => alEditar(oferta)}>
              <i className="ti ti-pencil" aria-hidden="true" /> Admin: Editar
            </button>
            <button className="btn-sm" style={{ backgroundColor: "#d9480f", color: "white", border: "none" }} onClick={() => alEliminar(id)}>
              <i className="ti ti-shield-x" aria-hidden="true" /> Admin: Eliminar
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}
