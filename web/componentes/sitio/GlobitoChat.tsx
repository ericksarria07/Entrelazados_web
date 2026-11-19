// Globito con los mensajes sin leer, junto a los enlaces al chat (antes en sesion.js)
"use client";
import { useNoLeidos } from "./ProveedorSitio";

export default function GlobitoChat() {
  const { total } = useNoLeidos();
  if (!total) return null;
  return (
    <span
      className="globo-no-leidos"
      title={`${total} mensaje${total === 1 ? "" : "s"} sin leer`}
      style={{
        display: "inline-block",
        minWidth: 18,
        padding: "0 5px",
        marginLeft: 5,
        borderRadius: 9,
        background: "#c92a2a",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: "18px",
        textAlign: "center",
        verticalAlign: "middle",
      }}
    >
      {total > 99 ? "99+" : total}
    </span>
  );
}
