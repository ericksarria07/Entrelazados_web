// Cabecera de /inicio: el buscador usa el radio de cercanía de la barra de abajo
"use client";
import { useState } from "react";
import Buscador from "@/componentes/sitio/Buscador";
import Cabecera from "@/componentes/sitio/Cabecera";

export default function CabeceraInicio() {
  const [radio, setRadio] = useState(30);
  return (
    <>
      <Cabecera>
        <Buscador radio={radio} />
      </Cabecera>

      {/* BARRA DE FILTRO POR RADIO DE CERCANÍA */}
      <div className="distance-filter-container">
        <div className="distance-filter-card">
          <label htmlFor="distanceRange">
            <i className="ti ti-map-pin-cog" style={{ fontSize: 18, color: "var(--color-principal)" }} aria-hidden="true" />
            <strong>Radio de Cercanía:</strong>
          </label>
          <input
            type="range"
            id="distanceRange"
            min={5}
            max={200}
            step={5}
            value={radio}
            onChange={(e) => setRadio(Number(e.target.value))}
          />
          <span id="distanceBadge" className="distance-badge">
            {radio}km
          </span>
        </div>
      </div>
    </>
  );
}
