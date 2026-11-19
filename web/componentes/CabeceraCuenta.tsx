// Cabecera sencilla de las páginas de cuenta (login y registro): solo la marca.
// Estilos en el CSS Module de cada página (.login-header, .logo).
export default function CabeceraCuenta() {
  return (
    <header className="login-header">
      <a href="/" className="logo">
        Entre<span>Lazados</span>
      </a>
    </header>
  );
}
