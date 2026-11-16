// GET /api/salud: responde si la app y la base de datos (Neon) contestan.
// La usa la prueba de humo del despliegue y un monitor externo (ROADMAP §11).
import { connection } from "next/server";
import { obtenerPool } from "@/lib/db";

export async function GET() {
  // Siempre se ejecuta en cada request: nunca se prerenderiza ni se guarda en caché.
  await connection();

  try {
    await obtenerPool().query("SELECT 1");
    return Response.json({ estado: "ok", bd: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // El detalle va al log del servidor, nunca al cliente (podría incluir datos de la conexión).
    console.error("Salud: la base de datos no respondió:", (err as Error).message);
    return Response.json(
      { estado: "error", bd: "sin conexión" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
