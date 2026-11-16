// ==========================================================================
// CONEXIÓN A NEON (Postgres)
//
// Un solo Pool de node-postgres (pg) para toda la app, como recomienda Neon
// para Vercel. attachDatabasePool cierra las conexiones ociosas antes de que
// Vercel suspenda la función (Fluid compute), así no quedan conexiones colgadas.
//
//   DATABASE_URL  conexión con pooler (-pooler) de Neon
// ==========================================================================
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

function urlConexion(): string {
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) throw new Error("Falta la variable DATABASE_URL");
  // pg avisa que "sslmode=require" cambiará de significado; verify-full es el
  // comportamiento actual (verifica el certificado) y el más seguro.
  return url.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
}

let pool: Pool | undefined;

export function obtenerPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: urlConexion(), max: 5 });
    pool.on("error", (err) => console.error("Error en el pool de Neon:", err.message));
    attachDatabasePool(pool);
  }
  return pool;
}
