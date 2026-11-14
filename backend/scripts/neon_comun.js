// ==========================================================================
// CONEXIÓN A NEON (Postgres) PARA LOS SCRIPTS
//
// Lee las variables que deja `neon deploy` / `neon env pull` en backend/.env.local
// (y, si falta alguna, en backend/.env). Nunca imprime la cadena de conexión.
//
//   DATABASE_URL           conexión con pooler (-pooler): la que usa la aplicación
//   DATABASE_URL_UNPOOLED  conexión directa: para cargar el esquema y migraciones
//
// Driver: node-postgres (pg). Es el que recomienda Neon para Node y para Vercel
// (con Fluid compute y attachDatabasePool de @vercel/functions).
// ==========================================================================
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const BACKEND = path.join(__dirname, '..');
dotenv.config({ path: path.join(BACKEND, '.env.local'), quiet: true });
dotenv.config({ path: path.join(BACKEND, '.env'), quiet: true });

function urlRequerida(nombre) {
    const url = (process.env[nombre] || '').trim();
    if (!url) {
        console.error(`❌ Falta ${nombre}. Corre "neon env pull" dentro de backend/ (lo escribe en .env.local).`);
        process.exit(1);
    }
    // pg avisa que "sslmode=require" cambiará de significado; verify-full es el
    // comportamiento actual (verifica el certificado) y el más seguro.
    return url.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
}

function crearPool(nombre = 'DATABASE_URL', opciones = {}) {
    const pool = new Pool({ connectionString: urlRequerida(nombre), max: 5, ...opciones });
    pool.on('error', (err) => console.error('⚠️ Error en el pool de Neon:', err.message));
    return pool;
}

module.exports = { crearPool, BACKEND };
