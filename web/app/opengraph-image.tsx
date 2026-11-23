// Imagen que muestran WhatsApp, Facebook y otros al compartir un enlace del sitio
// (1200×630). Se genera una vez en el build con los colores de la marca y el logo.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "EntreLazados: mercado de materia prima para calzado y marroquinería en Nicaragua";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Imagen() {
  const logo = `data:image/png;base64,${(await readFile(join(process.cwd(), "public/logo.png"))).toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background: "linear-gradient(135deg, #3D170A 0%, #7D381B 100%)",
          color: "#ffffff",
          padding: 64,
        }}
      >
        <img src={logo} alt="" width={180} height={180} style={{ borderRadius: 36, background: "#ffffff", padding: 16 }} />
        <div style={{ display: "flex", fontSize: 84, letterSpacing: -1 }}>
          <span>Entre</span>
          <span style={{ color: "#F0A07A", marginLeft: -8 }}>Lazados</span>
        </div>
        <div style={{ display: "flex", fontSize: 36, color: "#F4E7DF", textAlign: "center" }}>
          Materia prima para calzado y marroquinería en Nicaragua
        </div>
      </div>
    ),
    size
  );
}
