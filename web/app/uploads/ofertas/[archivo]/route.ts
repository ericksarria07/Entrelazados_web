// GET /uploads/ofertas/<uuid>.<ext>: fotos guardadas en disco (tu máquina y las pruebas).
// En Vercel las fotos están en Vercel Blob y esta ruta no encuentra nada (404).
// Los nombres son aleatorios y nunca cambian: el navegador puede guardarlas en caché.
import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { CONTENT_TYPE, type Formato, carpetaLocal } from "@/lib/fotos";

export async function GET(_req: Request, ctx: RouteContext<"/uploads/ofertas/[archivo]">) {
  await connection();
  const { archivo } = await ctx.params;
  const coincide = /^[0-9a-f-]{36}\.(jpg|png|webp)$/.exec(archivo);
  if (!coincide) return new Response("No encontrado", { status: 404 });
  try {
    const datos = await fs.promises.readFile(path.join(carpetaLocal(), archivo));
    return new Response(new Uint8Array(datos), {
      headers: {
        "Content-Type": CONTENT_TYPE[coincide[1] as Formato],
        "Cache-Control": "public, max-age=2592000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
