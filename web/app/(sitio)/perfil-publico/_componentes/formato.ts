// Formatos del perfil público (los usan la página del servidor y los componentes del navegador)
export const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
export const estrellasFijas = (n: number) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
