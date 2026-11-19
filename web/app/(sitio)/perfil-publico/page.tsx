// /perfil-publico?id=: perfil que se puede compartir (antes perfil-publico.html, ROADMAP 2.3).
// Se arma en el servidor (carga rápido y los buscadores lo leen); las reseñas, publicaciones
// y subastas se piden por páginas desde el navegador. No pide sesión.
import type { Metadata } from "next";
import Link from "next/link";
import Cabecera from "@/componentes/sitio/Cabecera";
import GlobitoChat from "@/componentes/sitio/GlobitoChat";
import PiePagina from "@/componentes/sitio/PiePagina";
import comun from "@/app/estilos/comun.module.css";
import mercado from "@/app/estilos/mercado.module.css";
import { ErrorHttp } from "@/lib/http";
import { datosDeSesionDesdeCookies } from "@/lib/sesion";
import { perfilPublico } from "@/lib/usuarios";
import { BotonCompartir, estrellasFijas, plural, Publicaciones, Resenas, Subastas } from "./_componentes/Secciones";
import estilos from "./perfil-publico.module.css";

type Perfil = Awaited<ReturnType<typeof perfilPublico>>;
type Props = { searchParams: Promise<{ id?: string }> };

const iniciales = (nombre: string) =>
  String(nombre)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase() || "?";

async function cargar(id: string | undefined): Promise<Perfil | { error: [string, string] }> {
  if (!(Number.parseInt(id ?? "", 10) > 0)) return { error: ["Falta el perfil", "El enlace no dice de quién es el perfil."] };
  try {
    return await perfilPublico(Number.parseInt(id!, 10));
  } catch (e) {
    if (e instanceof ErrorHttp && e.status === 404)
      return { error: ["Perfil no disponible", "Este perfil no existe o la cuenta ya no está activa."] };
    return { error: ["No se pudo cargar el perfil", "Revisa tu conexión e inténtalo de nuevo."] };
  }
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const p = await cargar((await searchParams).id);
  if ("error" in p) return { title: "Perfil", robots: { index: false } };
  return {
    title: p.nombre,
    description: `${p.rol} en EntreLazados${p.departamento ? ` · ${p.departamento}` : ""}`,
  };
}

function TarjetaError({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <section className="tarjeta error-perfil">
      <i className="ti ti-user-question" aria-hidden="true" />
      <h1>{titulo}</h1>
      <p>{texto}</p>
      <Link href="/mercado" className="btn-primary" style={{ textDecoration: "none" }}>
        <i className="ti ti-building-store" aria-hidden="true" /> Ir al Mercado
      </Link>
    </section>
  );
}

function VistaPerfil({ p, miId }: { p: Perfil; miId: number | null }) {
  const esProveedor = p.rol === "Proveedor";
  const esMio = miId === p.id;
  const conSesion = miId !== null;
  const subtitulo = esProveedor ? p.nombreComercial : p.marca;
  const r = p.reputacion;
  const datosSobre = [
    esProveedor && p.materiaPrincipal ? ["Vende principalmente", p.materiaPrincipal] : null,
    !esProveedor && p.especialidad ? ["Especialidad", p.especialidad] : null,
    p.departamento ? ["Departamento", p.departamento] : null,
  ].filter(Boolean) as [string, string][];
  const maxBarra = Math.max(1, ...Object.values(r.distribucion));
  const cifras = [
    esProveedor ? [p.estadisticas.publicaciones, "Publicaciones"] : null,
    esProveedor ? [p.estadisticas.subastasActivas, "Subastas activas"] : null,
    [p.estadisticas.tratosCompletados, "Tratos completados"],
    [
      r.total && r.promedio !== null ? r.promedio.toFixed(1) + " ★" : "—",
      r.total ? plural(r.total, "calificación", "calificaciones") : "Sin calificaciones",
    ],
  ].filter(Boolean) as [string | number, string][];

  return (
    <div id="perfil">
      <section className="tarjeta" aria-labelledby="nombre-perfil">
        <div className="perfil-cabecera">
          <div className="perfil-avatar" aria-hidden="true">
            {iniciales(p.nombre)}
          </div>
          <div className="perfil-datos">
            <h1 id="nombre-perfil">{p.nombre}</h1>
            {subtitulo && subtitulo !== p.nombre && <div className="perfil-sub">{subtitulo}</div>}
            <div className="perfil-meta">
              <span className="badge badge-rol">
                <i className={`ti ${esProveedor ? "ti-truck" : "ti-shoe"}`} aria-hidden="true" /> {p.rol}
              </span>
              {p.departamento && (
                <span>
                  <i className="ti ti-map-pin" aria-hidden="true" /> {p.departamento}
                </span>
              )}
              <span>
                <i className="ti ti-calendar" aria-hidden="true" /> En EntreLazados desde{" "}
                {new Date(p.miembroDesde).toLocaleDateString("es-NI", { month: "long", year: "numeric" })}
              </span>
            </div>
            <div className="perfil-acciones">
              {/* "Escribirle": sin sesión lleva al login */}
              {!esMio &&
                (conSesion ? (
                  <Link className="btn-primary" href={`/chat?contacto=${p.id}`}>
                    <i className="ti ti-message-circle" aria-hidden="true" /> Escribirle
                  </Link>
                ) : (
                  <Link className="btn-primary" href="/login">
                    <i className="ti ti-login" aria-hidden="true" /> Inicia sesión para escribirle
                  </Link>
                ))}
              {esProveedor && p.estadisticas.publicaciones > 0 && (
                <Link className="btn-sm" href={`/mercado?proveedor=${p.id}&nombre=${encodeURIComponent(p.nombre)}`}>
                  <i className="ti ti-building-store" aria-hidden="true" /> Ver en el Mercado
                </Link>
              )}
              <BotonCompartir perfilId={p.id} nombre={p.nombre} />
            </div>
            {esMio && (
              <p className="aviso-propio">
                <i className="ti ti-eye" aria-hidden="true" /> Así ven tu perfil los demás (no se muestran tu correo ni tu
                teléfono). <Link href="/perfil">Editar mis datos</Link>
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="cifras">
        {cifras.map(([n, t]) => (
          <div className="cifra" key={t}>
            <strong>{n}</strong>
            <span>{t}</span>
          </div>
        ))}
      </div>

      {(p.descripcion || datosSobre.length > 0) && (
        <section className="tarjeta sobre" aria-labelledby="titulo-sobre">
          <h2 id="titulo-sobre">
            <i className="ti ti-info-circle" style={{ color: "var(--color-principal)" }} aria-hidden="true" />{" "}
            {esProveedor ? "Sobre la empresa" : "Sobre su taller"}
          </h2>
          {p.descripcion && <p>{p.descripcion}</p>}
          {datosSobre.length > 0 && (
            <dl>
              {datosSobre.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      <section className="tarjeta" aria-labelledby="titulo-resenas">
        <h2 id="titulo-resenas">
          <i className="ti ti-star" style={{ color: "#c98500" }} aria-hidden="true" /> Calificaciones y reseñas
        </h2>
        {r.total && r.promedio !== null ? (
          <>
            <div className="reputacion">
              <div className="promedio-grande">
                <strong>{r.promedio.toFixed(1)}</strong>
                <div className="estrellas-fijas" aria-label={`${r.promedio} de 5 estrellas`}>
                  {estrellasFijas(r.promedio)}
                </div>
                <span>{plural(r.total, "calificación", "calificaciones")} en tratos completados</span>
              </div>
              <div className="barras">
                {[5, 4, 3, 2, 1].map((n) => {
                  const cant = r.distribucion[n] || 0;
                  return (
                    <div className="barra" key={n}>
                      <span>{n} ★</span>
                      <div
                        className="barra-fondo"
                        role="img"
                        aria-label={`${plural(cant, "calificación", "calificaciones")} de ${n} estrella${n === 1 ? "" : "s"}`}
                      >
                        <div className="barra-relleno" style={{ width: `${(cant / maxBarra) * 100}%` }} />
                      </div>
                      <span>{cant}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <Resenas perfilId={p.id} />
          </>
        ) : (
          <p className="vacio-tarjeta">Todavía no tiene calificaciones. Se califican al completar un trato.</p>
        )}
      </section>

      {esProveedor && (
        <>
          <Publicaciones perfilId={p.id} />
          <Subastas perfilId={p.id} />
        </>
      )}
    </div>
  );
}

export default async function PaginaPerfilPublico({ searchParams }: Props) {
  const [p, sesion] = await Promise.all([cargar((await searchParams).id), datosDeSesionDesdeCookies()]);
  const conSesion = !!sesion;

  return (
    <div className={`${comun.pagina} ${mercado.pagina} ${estilos.pagina}`}>
      <Cabecera ubicacion={false}>
        <div style={{ flex: 1 }} />
      </Cabecera>

      <nav className="sub-bar" aria-label="Secciones">
        <Link href={conSesion ? "/inicio" : "/"}>
          <i className="ti ti-home" aria-hidden="true" /> Inicio
        </Link>
        <Link href="/mercado">
          <i className="ti ti-building-store" aria-hidden="true" /> Mercado
        </Link>
        {conSesion && (
          <>
            <Link href="/chat">
              <i className="ti ti-message-circle" aria-hidden="true" /> Chats
              <GlobitoChat />
            </Link>
            <Link href="/dashboard">
              <i className="ti ti-chart-bar" aria-hidden="true" /> Dashboard
            </Link>
          </>
        )}
      </nav>

      {/* "Saltar al contenido" llega aquí; #app es el id que usan los estilos */}
      <span id="contenido-principal" tabIndex={-1} />
      <main id="app">
        {"error" in p ? <TarjetaError titulo={p.error[0]} texto={p.error[1]} /> : <VistaPerfil p={p} miId={sesion?.id ?? null} />}
      </main>

      <PiePagina
        enlaces={[
          [conSesion ? "/inicio" : "/", "Inicio"],
          ["/mercado", "Mercado"],
          ["/perfil", "Mi Perfil"],
        ]}
      />
    </div>
  );
}
