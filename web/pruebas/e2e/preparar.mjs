// ==========================================================================
// PREPARACIÓN DE LAS PRUEBAS E2E (globalSetup de Playwright)
// Vacía la base de PRUEBAS, aplica las migraciones y carga la semilla, igual que
// test:api. Nunca toca producción: se niega si PRUEBAS_DATABASE_URL es DATABASE_URL.
// ==========================================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { conSslVerificado } from '../api/contexto.mjs';
import { sembrar } from '../api/semilla.mjs';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const servidor = (url) => {
    try {
        const u = new URL(url);
        return `${u.hostname.replace('-pooler.', '.')}:${u.port || 5432}/${u.pathname.slice(1)}`;
    } catch {
        return null;
    }
};

export default async function preparar() {
    const url = (process.env.PRUEBAS_DATABASE_URL ?? '').trim();
    if (!url) throw new Error('Falta PRUEBAS_DATABASE_URL (ver README: "Pruebas E2E").');
    const produccion = (process.env.DATABASE_URL ?? '').trim();
    if (produccion && servidor(produccion) === servidor(url)) throw new Error('PRUEBAS_DATABASE_URL apunta a la base de DATABASE_URL.');
    const directa = new pg.Client({ connectionString: conSslVerificado((process.env.PRUEBAS_DATABASE_URL_UNPOOLED ?? '').trim() || url) });
    await directa.connect();
    await directa.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(drizzle({ client: directa }), { migrationsFolder: path.join(WEB, 'db', 'migraciones') });
    const pool = new pg.Pool({ connectionString: conSslVerificado(url), max: 2 });
    await sembrar(pool);
    await pool.end();
    await directa.end();
}
