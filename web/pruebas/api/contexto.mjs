// ==========================================================================
// AYUDAS COMPARTIDAS POR LAS SECCIONES DE LAS PRUEBAS DE LA API
//
//   api()      llamada JSON a la API (con o sin token)
//   check()    registra una comprobación (✅ / ❌)
//   seccion()  título de sección en el informe
//   q()        consulta directa a la base de PRUEBAS (Postgres)
//   B          URL del servidor de pruebas
//   conectarOyente()  escucha los avisos en tiempo real (Ably) como lo hace sesion.js
//   omitir()   anota una comprobación que no se pudo correr (no cuenta como fallida)
//
// q() devuelve las filas con los nombres de columna de MySQL (ContrasenaHash,
// EsPrincipal) y los booleanos como 1/0, igual que mysql2. Así las comprobaciones
// portadas de backend/pruebas/pruebas_api.js no cambiaron: solo el SQL.
// En un INSERT devuelve { insertId } (el SQL termina en RETURNING <llave>).
// ==========================================================================
import { createClient } from '@ably/pubsub-device';
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

// Comprobaciones que necesitan algo que no hay en este entorno (p. ej. Ably en el CI)
let omitidas = 0;
export function omitir(nombre, motivo) {
    omitidas++;
    resultados.push(`  ⏭️  ${nombre} (omitida: ${motivo})`);
}

export function informe() {
    return { ok, fallos, omitidas, texto: resultados.join('\n') };
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

// ----------------------------------------------------------------- tiempo real (Ably)
// Con ABLY_API_KEY el servidor publica en Ably y las pruebas escuchan como una página.
export const hayTiempoReal = Boolean((process.env.ABLY_API_KEY ?? '').trim());

// Se conecta como lo hace sesion.js: pide el permiso a /api/tiempo-real/token y se suscribe
// al canal público y, con sesión, al propio. Devuelve { socket, ok, error }, donde socket
// imita al cliente de Socket.IO que usaban las pruebas: on/off/once(evento, fn), close(), connected.
export async function conectarOyente(token) {
    const pedir = async () => {
        const r = await fetch(B + '/api/tiempo-real/token', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
        if (r.status === 401 || r.status === 403) throw new Error('sesion-invalida');
        if (!r.ok) throw new Error('sin-tiempo-real');
        return r.json();
    };
    const oyentes = new Map();
    const socket = {
        connected: false,
        on(evento, fn) { if (!oyentes.has(evento)) oyentes.set(evento, new Set()); oyentes.get(evento).add(fn); },
        off(evento, fn) { oyentes.get(evento)?.delete(fn); },
        once(evento, fn) { const f = (d) => { socket.off(evento, f); fn(d); }; socket.on(evento, f); },
        close() { cliente?.close(); socket.connected = false; },
    };
    let cliente;
    let permiso;
    try {
        permiso = await pedir();
    } catch (err) {
        return { socket, ok: false, error: err.message };
    }
    let primero = permiso.tokenRequest;
    cliente = createClient({
        authCallback: (_p, listo) => {
            if (primero) { listo(null, primero); primero = null; return; }
            pedir().then((x) => listo(null, x.tokenRequest), (e) => listo(e.message, null));
        },
    });
    cliente.connection.on(['disconnected', 'closed', 'failed', 'suspended'], () => {
        if (!socket.connected) return;
        socket.connected = false;
        for (const fn of [...(oyentes.get('disconnect') ?? [])]) fn();
    });
    const repartir = (m) => { for (const fn of [...(oyentes.get(m.name) ?? [])]) fn(m.data); };
    try {
        // Como mucho 10 s: si Ably no acepta la conexión, la prueba falla en vez de quedarse esperando
        await Promise.race([
            cliente.connection.once('connected'),
            new Promise((_, falla) => setTimeout(() => falla(new Error('Ably no conectó en 10 s')), 10000)),
        ]);
        await cliente.channels.get(permiso.canales.publico).subscribe(repartir);
        if (permiso.canales.usuario) await cliente.channels.get(permiso.canales.usuario).subscribe(repartir);
        socket.connected = true;
        socket.canales = permiso.canales;
        socket.cliente = cliente;
        return { socket, ok: true };
    } catch (err) {
        cliente.close();
        return { socket, ok: false, error: err.message };
    }
}
