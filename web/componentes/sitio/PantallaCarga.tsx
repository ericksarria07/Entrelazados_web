// Lo que se ve mientras el servidor revisa la sesión (normalmente un instante)
export default function PantallaCarga() {
  return (
    <div
      role="status"
      style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#7D381B" }}
    >
      <i className="ti ti-loader-2" aria-hidden="true" style={{ fontSize: 26 }} />
      Cargando…
    </div>
  );
}
