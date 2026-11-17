// ==========================================================================
// PRUEBAS DE INTEGRACIÓN DE LA API (Next.js + Postgres)
//
//   cd web && npm run build && npm run test:api
//
// 1. Vacía la base de PRUEBAS (PRUEBAS_DATABASE_URL), aplica las migraciones de
//    Drizzle (db/migraciones/) y carga la semilla (semilla.mjs).
// 2. Levanta Next.js (next start) en el puerto 3055 apuntando a esa base.
// 3. Comprueba /api/salud y corre las secciones activas (secciones.mjs), en orden.
//
// Nunca toca producción: se niega a correr si la base de pruebas es la misma que
// DATABASE_URL. Variables (web/.env.local en tu máquina; el CI las define solo):
//   PRUEBAS_DATABASE_URL           base de pruebas (en Neon: rama "pruebas", con pooler)
//   PRUEBAS_DATABASE_URL_UNPOOLED  la misma, conexión directa (para migrar); opcional
//   PRUEBAS_SECCIONES              opcional: "01,05" corre esas secciones aunque estén inactivas
// ==========================================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { B, PUERTO, cerrarBase, check, conSslVerificado, conectarBase, informe, seccion } from './contexto.mjs';
import { SECCIONES } from './secciones.mjs';
import { sembrar } from './semilla.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(AQUI, '..', '..');
const LOG_SERVIDOR = path.join(os.tmpdir(), 'entrelazados_next_pruebas.log');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function salir(mensaje, codigo = 2) {
    console.error(`❌ ${mensaje}`);
    process.exit(codigo);
}

// Endpoint de Neon (ep-xxx) o host:puerto, para comparar dos URLs sin importar el pooler
function servidorDe(url) {
    try {
        const u = new URL(url);
        return `${u.hostname.replace('-pooler.', '.')}:${u.port || 5432}/${u.pathname.slice(1)}`;
    } catch {
        return null;
    }
}

// ----------------------------------------------------------------- 0. qué correr
const urlPruebas = (process.env.PRUEBAS_DATABASE_URL ?? '').trim();
const urlMigrar = (process.env.PRUEBAS_DATABASE_URL_UNPOOLED ?? '').trim() || urlPruebas;
if (!urlPruebas) salir('Falta PRUEBAS_DATABASE_URL (ver README: "Pruebas de la API en Next.js").');
const produccion = (process.env.DATABASE_URL ?? '').trim();
if (produccion && servidorDe(produccion) === servidorDe(urlPruebas)) {
    salir('PRUEBAS_DATABASE_URL apunta a la misma base que DATABASE_URL. Las pruebas vacían la base: usa la rama "pruebas" de Neon.');
}
if (!fs.existsSync(path.join(WEB, '.next', 'BUILD_ID'))) salir('No hay build de Next.js. Corre primero: npm run build');

const forzadas = (process.env.PRUEBAS_SECCIONES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const activa = (s) => s.activa || forzadas.some((f) => s.archivo.startsWith(f));
const aCorrer = SECCIONES.filter(activa);
for (const s of aCorrer) {
    const faltan = (s.requiere ?? []).filter((r) => !aCorrer.some((x) => x.archivo === r));
    if (faltan.length) salir(`La sección ${s.archivo} requiere ${faltan.join(', ')}, que no está activa.`);
}

// ----------------------------------------------------------------- 1. base de pruebas
console.log('1/3 Base de pruebas: se vacía, se migra y se siembra...');
{
    const directa = new pg.Client({ connectionString: conSslVerificado(urlMigrar) });
    await directa.connect();
    await directa.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(drizzle({ client: directa }), { migrationsFolder: path.join(WEB, 'db', 'migraciones') });
    await directa.end();
}
const pool = conectarBase(urlPruebas);
await sembrar(pool);

// ----------------------------------------------------------------- 2. servidor
console.log(`2/3 Next.js en el puerto ${PUERTO} (log: ${LOG_SERVIDOR})`);
const log = fs.openSync(LOG_SERVIDOR, 'w');
const servidor = spawn(path.join(WEB, 'node_modules', '.bin', 'next'), ['start', '-p', String(PUERTO)], {
    cwd: WEB,
    stdio: ['ignore', log, log],
    env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: urlPruebas,
        // Las mismas variables que recibía Express en backend/pruebas/correr_pruebas.js
        JWT_SECRET: 'secreto-de-pruebas-local',
        GEMINI_API_KEY: 'sin-clave',
        EMAIL_USER: '', EMAIL_PASS: '', APP_URL: '', VERIFICAR_CORREO: '1',
        // El cierre de subastas lo controlan las pruebas con la ruta del admin (sección 15)
        CIERRE_PEREZOSO: '0',
        CRON_SECRET: 'secreto-cron-pruebas',
        LIMITE_REGISTRO: '40', LIMITE_RECUPERACION: '30', LIMITE_LOGIN: '30', LIMITE_API: '2000',
    },
});
const responde = () => fetch(`${B}/api/salud`).then((r) => r.status, () => 0);

let codigo = 1;
try {
    for (let i = 0; i < 60 && !(await responde()); i++) await esperar(500);

    // ------------------------------------------------------------- 3. pruebas
    console.log(`3/3 Pruebas: ${aCorrer.length} de ${SECCIONES.length} secciones activas\n`);
    seccion('0. Salud');
    const salud = await fetch(`${B}/api/salud`).then(async (r) => ({ status: r.status, data: await r.json() }), (e) => ({ error: e.message }));
    check('Next.js responde /api/salud contra la base de pruebas', salud.status === 200 && salud.data?.bd === 'ok', JSON.stringify(salud));

    const ctx = {};
    for (const s of aCorrer) {
        const { default: correr } = await import(`./secciones/${s.archivo}`);
        try {
            await correr(ctx);
        } catch (err) {
            // Una sección que se cae (p. ej. la ruta aún no existe) no detiene a las demás
            check(`La sección ${s.archivo} terminó sin errores`, false, err.stack?.split('\n').slice(0, 2).join(' ') ?? String(err));
        }
    }

    const { ok, fallos, texto } = informe();
    console.log(texto);
    const pendientes = SECCIONES.length - aCorrer.length;
    console.log(`\nRESULTADO: ${ok} correctas, ${fallos} fallidas · secciones activas ${aCorrer.length}/${SECCIONES.length}${pendientes ? ` (${pendientes} pendientes de migrar)` : ''}`);
    codigo = fallos ? 1 : 0;
} catch (err) {
    console.error('❌ ' + err.message);
} finally {
    servidor.kill();
    await cerrarBase();
}
if (codigo) console.error(`Log del servidor: ${LOG_SERVIDOR}`);
process.exit(codigo);
