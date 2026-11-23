"use client";
// Foto de una publicación o subasta con next/image: el navegador baja una versión del
// tamaño en que se muestra (WebP), no el original de varios cientos de KB.
// - Solo se optimizan los orígenes permitidos en next.config.ts (Vercel Blob, las fotos
//   locales de /uploads y las viejas de Unsplash); cualquier otra URL se muestra tal cual.
// - Si la versión optimizada falla (por ejemplo, el plan Hobby de Vercel agotó sus
//   transformaciones del mes y responde 402), se muestra la foto original. Si también
//   falla, se avisa con onError (el perfil público pone un ícono en su lugar).
import Image, { type ImageProps } from "next/image";
import { useState } from "react";

const OPTIMIZABLE = /^(\/uploads\/ofertas\/|https:\/\/([a-z0-9-]+\.public\.blob\.vercel-storage\.com\/ofertas\/|images\.unsplash\.com\/|plus\.unsplash\.com\/))/i;

export const esOptimizable = (src: string) => OPTIMIZABLE.test(src);

export default function FotoOferta({ src, alt, onError, ...resto }: Omit<ImageProps, "src"> & { src: string }) {
  const [original, setOriginal] = useState(!esOptimizable(src));
  return (
    <Image
      {...resto}
      src={src}
      alt={alt}
      unoptimized={original}
      onError={(e) => (original ? onError?.(e) : setOriginal(true))}
    />
  );
}
