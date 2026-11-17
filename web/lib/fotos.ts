// ==========================================================================
// FOTOS DE LAS OFERTAS (equivale a servicios/fotos.js)
//
// Llegan como archivos (multipart/form-data, campo "fotos"), igual que en Express:
// la página ya las reduce a 1600 px en WebP o JPG, así que 5 fotos caben en el
// límite de 4,5 MB por petición de Vercel.
//
// Dónde se guardan:
//   * con BLOB_READ_WRITE_TOKEN (Vercel): en Vercel Blob. En la base queda la
//     dirección completa (https://....public.blob.vercel-storage.com/ofertas/...).
//   * sin token (tu máquina, pruebas): en disco, en UPLOADS_DIR/ofertas (por defecto
//     una carpeta temporal), servidas por app/uploads/ofertas/[archivo]/route.ts
//     como "/uploads/ofertas/<uuid>.webp".
//
// Reglas: máximo 5 fotos por oferta y 5 MB por foto; solo JPG, PNG o WebP,
// comprobado con los primeros bytes (no con la extensión); el nombre lo genera
// el servidor (aleatorio), nunca el usuario.
// ==========================================================================
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { del, put } from "@vercel/blob";

export const MAX_FOTOS = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const PREFIJO_LOCAL = "/uploads/ofertas/";
const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"];
export const CONTENT_TYPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

export type Formato = keyof typeof CONTENT_TYPE;
export type Foto = { nombre: string; tipo: string; buffer: Buffer };

const usaBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export function carpetaLocal(): string {
  const base = process.env.UPLOADS_DIR || path.join(os.tmpdir(), "entrelazados-uploads");
  return path.join(path.resolve(base), "ofertas");
}

// Firma (primeros bytes) de cada formato permitido
export function detectarFormato(buffer: Buffer): Formato | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

// Revisa cantidad, tipo declarado y tamaño (lo que en Express hacía multer).
// Devuelve un mensaje de error o null.
export function revisarArchivos(archivos: File[]): string | null {
  if (archivos.length > MAX_FOTOS) return `Puedes subir como máximo ${MAX_FOTOS} fotos por oferta.`;
  for (const a of archivos) {
    if (!TIPOS_PERMITIDOS.includes(a.type)) return "Solo se aceptan fotos en formato JPG, PNG o WebP.";
    if (a.size > MAX_BYTES) return `Cada foto puede pesar como máximo ${MAX_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

export async function leerArchivos(archivos: File[]): Promise<Foto[]> {
  return Promise.all(archivos.map(async (a) => ({ nombre: a.name, tipo: a.type, buffer: Buffer.from(await a.arrayBuffer()) })));
}

// Revisa el contenido de cada foto. Devuelve un mensaje de error o null si todas son válidas.
export function validarFotos(fotos: Foto[]): string | null {
  for (const f of fotos) {
    if (!detectarFormato(f.buffer)) return `"${f.nombre}" no es una imagen JPG, PNG o WebP válida.`;
  }
  return null;
}

// Guarda las fotos y devuelve sus direcciones públicas (en el mismo orden).
// Si falla una, borra las que ya se guardaron.
export async function guardarFotos(fotos: Foto[]): Promise<string[]> {
  const urls: string[] = [];
  try {
    for (const f of fotos) {
      const formato = detectarFormato(f.buffer)!;
      const nombre = `${crypto.randomUUID()}.${formato}`;
      if (usaBlob()) {
        const blob = await put(`ofertas/${nombre}`, f.buffer, {
          access: "public",
          contentType: CONTENT_TYPE[formato],
          addRandomSuffix: false,
          cacheControlMaxAge: 30 * 24 * 60 * 60,
        });
        urls.push(blob.url);
      } else {
        await fs.promises.mkdir(carpetaLocal(), { recursive: true });
        await fs.promises.writeFile(path.join(carpetaLocal(), nombre), f.buffer, { flag: "wx" });
        urls.push(PREFIJO_LOCAL + nombre);
      }
    }
    return urls;
  } catch (err) {
    await borrarFotos(urls);
    throw err;
  }
}

const esDeBlob = (url: string) => /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/ofertas\//i.test(url);

// Borra las fotos indicadas por su dirección. Ignora las que no son de aquí
// (por ejemplo fotos antiguas guardadas como texto). Nunca lanza errores.
export async function borrarFotos(urls: unknown[]): Promise<void> {
  const deBlob = urls.filter((u): u is string => typeof u === "string" && esDeBlob(u));
  if (deBlob.length && usaBlob()) {
    await del(deBlob).catch((err) => console.error("⚠️ No se pudieron borrar fotos de Vercel Blob:", err.message));
  }
  for (const url of urls) {
    if (typeof url !== "string" || !url.startsWith(PREFIJO_LOCAL)) continue;
    const nombre = path.basename(url); // evita rutas como ../../index.js
    try {
      await fs.promises.unlink(path.join(carpetaLocal(), nombre));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("⚠️ No se pudo borrar la foto", nombre, (err as Error).message);
    }
  }
}
