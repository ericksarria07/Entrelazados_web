// Fotos de Unsplash de la portada y del inicio, del tamaño en que se muestran.
// Unsplash recorta en su servidor según el parámetro w (gratis, sin gastar las
// transformaciones de next/image del plan Hobby). Antes se pedían de ~1200 px para
// mostrarlas de 160–340 px. Con 1x y 2x el navegador elige según la pantalla; más de 2x
// casi no se nota y pesa mucho más.
export function fotoUnsplash(url: string, ancho: number): { src: string; srcSet: string } {
  const conAncho = (w: number) => {
    const u = new URL(url);
    u.searchParams.set("w", String(Math.round(w)));
    return u.toString();
  };
  return { src: conAncho(ancho), srcSet: `${conAncho(ancho)} 1x, ${conAncho(ancho * 2)} 2x` };
}
