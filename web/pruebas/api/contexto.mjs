// ==========================================================================
// AYUDAS COMPARTIDAS POR LAS SECCIONES DE LAS PRUEBAS DE LA API
//
//   api()      llamada JSON a la API (con o sin token, o con la cookie de sesión)
//   iniciarSesion()  POST /api/login; el token sale de la cookie "sesion" (data.token)
//   check()    registra una comprobación (✅ / ❌)
//   seccion()  título de sección en el informe
//   q()        consulta directa a la base de PRUEBAS (Postgres)
//   B          URL del servidor de pruebas
//   conectarOyente()  escucha los avisos en tiempo real (Ably) como lo hace sesion.js
//   omitir()   anota una comprobación que no se pudo correr (no cuenta como fallida)
//   enlaceDelLog()  el último token de un enlace de recuperación o confirmación que el
//              servidor escribió en su log (la base guarda solo su SHA-256)
//
// q() devuelve las filas con los nombres de columna de MySQL (ContrasenaHash,
// EsPrincipal) y los booleanos como 1/0, igual que mysql2. Así las comprobaciones
// portadas de backend/pruebas/pruebas_api.js no cambiaron: solo el SQL.
// En un INSERT devuelve { insertId } (el SQL termina en RETURNING <llave>).
// ==========================================================================
import { createClient } from '@ably/pubsub-device';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { NOMBRES_MYSQL } from './nombres-mysql.mjs';

export const PUERTO = 3055;
export const LOG_SERVIDOR = path.join(os.tmpdir(), 'entrelazados_next_pruebas.log');

// Sin correo configurado, el servidor escribe los enlaces en su log. tipo: 'recuperacion' | 'confirmacion'
export function enlaceDelLog(tipo, email) {
    const frase = tipo === 'recuperacion' ? 'Enlace de recuperación para' : 'Enlace para confirmar el correo de';
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${esc(frase)} ${esc(email)} .*token=([a-f0-9]{64})`, 'g');
    const todos = [...fs.readFileSync(LOG_SERVIDOR, 'utf8').matchAll(regex)];
    return todos.length ? todos[todos.length - 1][1] : null;
}
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

export async function api(metodo, ruta, { token, cookie, body, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = 'Bearer ' + token;
    if (cookie) h['Cookie'] = cookie;
    const r = await fetch(B + ruta, { method: metodo, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await r.json(); } catch { /* respuesta sin JSON */ }
    return { status: r.status, data, setCookie: r.headers.getSetCookie() };
}

// La cookie "sesion" de una respuesta: { valor, atributos } (atributos en minúsculas), o null
export function cookieSesion(setCookie = []) {
    const linea = setCookie.find((c) => c.startsWith('sesion='));
    if (!linea) return null;
    const [par, ...resto] = linea.split(';');
    return { valor: decodeURIComponent(par.slice('sesion='.length)), atributos: resto.map((a) => a.trim().toLowerCase()), linea };
}

// Inicia sesión como la página: la sesión llega en la cookie httpOnly. Para que las secciones
// sigan usando ctx.p1.token (Bearer), el valor de la cookie se copia a data.token.
// tokenEnCuerpo dice si la API (todavía) devolvió el token en el JSON.
export async function iniciarSesion(email, password) {
    const r = await api('POST', '/api/login', { body: { email, password } });
    const tokenEnCuerpo = Boolean(r.data && 'token' in r.data);
    const cookie = cookieSesion(r.setCookie);
    if (r.status === 200 && r.data && cookie) r.data = { ...r.data, token: cookie.valor };
    return { ...r, cookie, tokenEnCuerpo };
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
