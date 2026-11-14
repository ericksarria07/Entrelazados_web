// ==========================================================================
// CARGAR EL ESQUEMA POSTGRES EN NEON
//
//   npm run db:esquema:neon
//
// Ejecuta sql/esquema_postgres.sql en una sola transacción, por la conexión
// DIRECTA (DATABASE_URL_UNPOOLED): el pooler no sirve para cambios de esquema.
// Si las tablas ya existen no hace nada, así que se puede correr sin miedo.
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { crearPool, BACKEND } = require('./neon_comun');

async function main() {
    const pool = crearPool('DATABASE_URL_UNPOOLED', { max: 1 });
    const client = await pool.connect();
    try {
        const { rows } = await client.query(`SELECT to_regclass('public.usuarios') IS NOT NULL AS existe`);
        if (rows[0].existe) {
            console.log('ℹ️  El esquema ya está cargado (existe la tabla usuarios). No se cambió nada.');
            return;
        }

        const sql = fs.readFileSync(path.join(BACKEND, 'sql', 'esquema_postgres.sql'), 'utf8');
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');

        const { rows: tablas } = await client.query(
            `SELECT count(*)::int AS total FROM information_schema.tables
             WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
        );
        console.log(`✅ Esquema cargado en Neon: ${tablas[0].total} tablas.`);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    console.error('❌ No se pudo cargar el esquema:', err.message);
    process.exit(1);
});
