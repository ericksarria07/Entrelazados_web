// ==========================================================================
// AYUDAS COMPARTIDAS POR LAS SECCIONES DE LAS PRUEBAS DE LA API
//
//   api()      llamada JSON a la API (con o sin token)
//   check()    registra una comprobación (✅ / ❌)
//   seccion()  título de sección en el informe
//   q()        consulta directa a la base de PRUEBAS (Postgres)
//   B          URL del servidor de pruebas
//
// q() devuelve las filas con los nombres de columna de MySQL (ContrasenaHash,
// EsPrincipal) y los booleanos como 1/0, igual que mysql2. Así las comprobaciones
// portadas de backend/pruebas/pruebas_api.js no cambiaron: solo el SQL.
// En un INSERT devuelve { insertId } (el SQL termina en RETURNING <llave>).
// ==========================================================================
import pg from 'pg';
import { NOMBRES_MYSQL } from './nombres-mysql.mjs';

export const PUERTO = 3055;
export const B = `http://localhost:${PUERTO}`;

let ok = 0;
let fallos = 0;
const resultados = [];

export function check(nombre, condicion, detalle = '') {
    if (condicion) { ok++; resultados.push(`  ✅ ${nombre}`); }
    else { fallos++; resultados.push(`  ❌ ${nombre} ${detalle}`); }
}

export function seccion(titulo) {
    resultados.push(`\n${titulo}`);
}

export function informe() {
    return { ok, fallos, texto: resultados.join('\n') };
}

export async function api(metodo, ruta, { token, body, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = 'Bearer ' + token;
    const r = await fetch(B + ruta, { method: metodo, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await r.json(); } catch { /* respuesta sin JSON */ }
    return { status: r.status, data };
}

// ----------------------------------------------------------------- base de pruebas
let pool;

export function conectarBase(url) {
    pool = new pg.Pool({ connectionString: conSslVerificado(url), max: 4 });
    pool.on('error', (err) => console.error('⚠️ Error en el pool de pruebas:', err.message));
    return pool;
}

export async function cerrarBase() {
    await pool?.end();
}

// pg avisa que "sslmode=require" cambiará de significado; verify-full es el actual
export function conSslVerificado(url) {
    return url.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
}

function aMySQL(fila) {
    const salida = {};
    for (const [k, v] of Object.entries(fila)) salida[NOMBRES_MYSQL[k] ?? k] = typeof v === 'boolean' ? Number(v) : v;
    return salida;
}

export async function q(sql, params = []) {
    const { rows } = await pool.query(sql, params);
    if (/^\s*insert/i.test(sql)) return { insertId: rows[0] ? Object.values(rows[0])[0] : undefined, filas: rows.map(aMySQL) };
    return rows.map(aMySQL);
}
