// ==========================================================================
// BUSCADOR DE LA CABECERA (antes ejecutarBusqueda() en cada página)
// Las categorías vienen de la base. Lleva al Mercado con ?q=&categoria=.
// Con `radio` (página de inicio) primero pregunta si hay alguna oferta en ese radio.
// ==========================================================================
"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useCategorias } from "@/lib/cliente/categorias";
import { useUsuario } from "./ProveedorSitio";

export default function Buscador({ radio }: { radio?: number }) {
  const router = useRouter();
  const categorias = useCategorias();
  const usuario = useUsuario();
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState("todos");

  async function buscar(e: FormEvent) {
    e.preventDefault();
    const q = texto.trim();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (categoria !== "todos") params.set("categoria", categoria);

    if (radio !== undefined) {
      const departamento = usuario?.departamento || "Managua";
      try {
        // El servidor filtra y solo cuenta: basta pedir una oferta para saber si hay alguna
        const filtros = new URLSearchParams({ pagina: "1", porPagina: "1", maxKm: String(radio) });
        if (q) filtros.set("q", q);
        if (categoria !== "todos") filtros.set("categoria", categoria);
        const res = await fetch(`/api/ofertas?${filtros}`);
        if (!res.ok) throw new Error("Error al obtener ofertas");
        if (!((await res.json()) as { total: number }).total) {
          alert(`No hay ofertas disponibles dentro de un radio de ${radio}km desde ${departamento}.`);
          return;
        }
        params.set("radio", String(radio));
        params.set("depto", departamento);
      } catch (error) {
        console.error("Error comprobando ofertas:", error);
        alert("Ocurrió un error al verificar la disponibilidad de productos en tu zona.");
        return;
      }
    }
    router.push(`/mercado?${params}`);
  }

  return (
    <form id="searchForm" className="search-bar" onSubmit={buscar} role="search">
      <select
        id="searchCategory"
        className="search-category"
        aria-label="Categoría"
        value={categoria}
        onChange={(e) => setCategoria(e.target.value)}
      >
        <option value="todos">Todos los insumos</option>
        {categorias?.map((c) => (
          <option key={c.CategoriaID} value={String(c.CategoriaID)}>
            {c.NombreCategoria}
          </option>
        ))}
        {categorias && !categorias.length && (
          <option value="" disabled>
            No se pudieron cargar las categorías
          </option>
        )}
      </select>
      <input
        type="text"
        id="searchInput"
        className="search-input"
        aria-label="Buscar"
        placeholder="Buscar cuero vacuno, hebillas, remaches, suelas..."
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <button type="submit" className="search-btn" aria-label="Buscar">
        <i className="ti ti-search" aria-hidden="true" />
      </button>
    </form>
  );
}
