// Cualquier /api/... que no exista responde 404 en JSON, como Express (rutaNoEncontrada).
// Las rutas concretas (app/api/login, app/api/salud...) tienen prioridad sobre esta.
import { connection } from "next/server";

async function noEncontrada() {
  await connection();
  return Response.json({ message: "Ruta no encontrada." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export { noEncontrada as GET, noEncontrada as POST, noEncontrada as PUT, noEncontrada as PATCH, noEncontrada as DELETE };
