// ==========================================================================
// CONEXIÓN A NEON (Postgres)
//
// Un solo Pool de node-postgres (pg) para toda la app, como recomienda Neon
// para Vercel. attachDatabasePool cierra las conexiones ociosas antes de que
// Vercel suspenda la función (Fluid compute), así no quedan conexiones colgadas.
//
//   DATABASE_URL  conexión con pooler (-pooler) de Neon
//
//   db             Drizzle con el esquema de db/esquema.ts (lo normal)
//   obtenerPool()  el Pool de pg: las rutas escriben su SQL a mano ($1, $2...)
//   enTransaccion  ejecuta varias consultas como una sola (COMMIT o ROLLBACK)
// ==========================================================================
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as esquema from "@/db/esquema";

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

function crearDb() {
  return drizzle({ client: obtenerPool(), schema: esquema, casing: "snake_case" });
}

let instancia: ReturnType<typeof crearDb> | undefined;

// Se crea al primer uso (no al importar), para que el build no necesite DATABASE_URL.
export const db = new Proxy({} as ReturnType<typeof crearDb>, {
  get(_destino, propiedad) {
    instancia ??= crearDb();
    return Reflect.get(instancia, propiedad, instancia);
  },
});

// Ejecuta fn(cliente) dentro de una transacción: si fn termina bien se confirma
// (COMMIT); si lanza un error se deshace todo (ROLLBACK) y el error sigue su camino.
// La conexión siempre se devuelve al pool.
export async function enTransaccion<T>(fn: (cliente: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await obtenerPool().connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await fn(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}
