// ==========================================================================
// RECORRIDO COMPLETO DEL SITIO CON CAPTURAS (Playwright)
//
//   cd web && npm run recorrido                      (contra producción)
//   RECORRIDO_URL=http://localhost:3000 npm run recorrido
//
// Recorre las páginas como lo haría una persona, en tamaño de teléfono, con
// cuentas temporales (correos @example.com con un prefijo único):
//   proveedor, 2 emprendedores y un admin temporal.
// Saca una captura por paso y anota los errores de la consola y las respuestas
// 4xx/5xx inesperadas. Al final, pase lo que pase, el admin temporal borra las
// cuentas temporales por la API (con sus fotos y datos) y se borra a sí mismo.
//
// Necesita DATABASE_URL (web/.env.local) de la MISMA base que usa RECORRIDO_URL:
// con ella confirma los correos de las cuentas temporales (a example.com no
// llegan los enlaces), crea el admin temporal y revisa que todo quede limpio.
//
// Resultado: pruebas/recorrido/salida/ (capturas .jpg + resultado.json, fuera de git).
// ==========================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { chromium } from 'playwright';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = path.join(AQUI, 'salida');
const BASE = (process.env.RECORRIDO_URL || 'https://entrelazados.ericksv.com').replace(/\/+$/, '');
const PREFIJO = `rec${Date.now().toString(36)}`;
const CLAVE = 'Recorrido123';
const correo = (quien) => `${PREFIJO}-${quien}@example.com`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.env.DATABASE_URL) {
    console.error('❌ Falta DATABASE_URL (web/.env.local).');
    process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full'), max: 3 });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

fs.rmSync(SALIDA, { recursive: true, force: true });
fs.mkdirSync(SALIDA, { recursive: true });

// ----------------------------------------------------------------- fotos de prueba (PNG)
function png(ancho, alto, [r, g, b]) {
    const fila = Buffer.alloc(1 + ancho * 3);
    for (let x = 0; x < ancho; x++) {
        const tono = Math.round(40 * Math.sin(x / 12));
        fila[1 + x * 3] = Math.max(0, Math.min(255, r + tono));
        fila[2 + x * 3] = Math.max(0, Math.min(255, g + tono));
        fila[3 + x * 3] = Math.max(0, Math.min(255, b + tono));
    }
    const datos = Buffer.concat(Array.from({ length: alto }, () => fila));
    const bloque = (tipo, contenido) => {
        const largo = Buffer.alloc(4);
        largo.writeUInt32BE(contenido.length);
        const tc = Buffer.concat([Buffer.from(tipo), contenido]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(tc) >>> 0);
        return Buffer.concat([largo, tc, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(ancho, 0);
    ihdr.writeUInt32BE(alto, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloque('IHDR', ihdr), bloque('IDAT', zlib.deflateSync(datos)), bloque('IEND', Buffer.alloc(0))]);
}
const FOTOS = [
    { name: 'cuero-cafe.png', mimeType: 'image/png', buffer: png(400, 300, [120, 72, 40]) },
    { name: 'cuero-detalle.png', mimeType: 'image/png', buffer: png(400, 300, [150, 95, 55]) },
];

// ----------------------------------------------------------------- registro de pasos
const pasos = [];
let numero = 0;

// Navegador con un "contexto" por persona (cada uno con su propia sesión)
const navegador = await chromium.launch();
const personas = {};

async function abrirPersona(nombre) {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-NI', acceptDownloads: true });
    const pagina = await contexto.newPage();
    const p = { nombre, contexto, pagina, errores: [], dialogos: [], respuestaPrompt: '' };
    pagina.on('console', (m) => { if (m.type() === 'error') p.errores.push(`consola: ${m.text().slice(0, 200)}`); });
    pagina.on('pageerror', (e) => p.errores.push(`error de la página: ${e.message.slice(0, 200)}`));
    pagina.on('response', (r) => {
        const u = r.url();
        if (r.status() >= 500 || (r.status() >= 400 && u.startsWith(BASE) && !p.esperados?.some((x) => u.includes(x)))) {
            p.errores.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`);
        }
    });
    pagina.on('dialog', async (d) => {
        p.dialogos.push(d.message());
        if (d.type() === 'prompt') await d.accept(p.respuestaPrompt);
        else await d.accept();
    });
    personas[nombre] = p;
    return p;
}

// Un paso: corre fn, saca la captura de la página de esa persona y anota el resultado
async function paso(persona, titulo, descripcion, fn, { esperados = [] } = {}) {
    numero++;
    const p = personas[persona];
    p.errores = [];
    p.dialogos = [];
    p.esperados = esperados;
    const inicio = Date.now();
    let ok = true;
    let detalle = '';
    try {
        detalle = (await fn(p.pagina, p)) || '';
    } catch (err) {
        ok = false;
        detalle = err.message.split('\n')[0].slice(0, 300);
    }
    await esperar(400);
    const archivo = `${String(numero).padStart(2, '0')}-${titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}.jpg`;
    try {
        await p.pagina.screenshot({ path: path.join(SALIDA, archivo), type: 'jpeg', quality: 72 });
    } catch {
        /* sin captura */
    }
    const errores = [...new Set(p.errores)];
    pasos.push({ numero, persona, titulo, descripcion, ok, detalle, dialogos: [...p.dialogos], errores, archivo, ms: Date.now() - inicio, url: p.pagina.url().replace(BASE, '') });
    console.log(`${ok ? '✅' : '❌'} ${String(numero).padStart(2)}. [${persona}] ${titulo}${detalle ? ` — ${detalle}` : ''}${errores.length ? `  ⚠️ ${errores.join(' | ')}` : ''}`);
    return ok;
}

// networkidle: espera a que la página termine de pedir datos. Las que consultan cada pocos
// segundos (p. ej. una cuenta suspendida reintentando) usan 'load'.
const ir = async (pagina, ruta, waitUntil = 'networkidle') => {
    await pagina.goto(BASE + ruta, { waitUntil, timeout: 45000 });
};

async function api(metodo, ruta, { token, body } = {}) {
    const r = await fetch(BASE + ruta, {
        method: metodo,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch { /* sin JSON */ }
    return { status: r.status, data };
}

async function iniciarSesionUI(pagina, email) {
    await ir(pagina, '/login.html');
    await pagina.fill('#login-email', email);
    await pagina.fill('#login-password', CLAVE);
    await Promise.all([pagina.waitForURL(/index\.html|admin\.html/, { timeout: 30000 }), pagina.click('#btn-submit-login')]);
    await pagina.waitForLoadState('networkidle');
}

// Crea una cuenta directo en la base (ya confirmada). Se usa para el emprendedor 2 y
// cuando el registro choca con el límite de 5 cuentas por hora (LIMITE_REGISTRO).
async function crearCuentaEnBase(email, rol, nombre, depto) {
    const hash = bcrypt.hashSync(CLAVE, 10);
    const [{ departamento_id }] = await q(`INSERT INTO departamentos (nombre_departamento) VALUES ($1) ON CONFLICT (nombre_departamento) DO UPDATE SET nombre_departamento = EXCLUDED.nombre_departamento RETURNING departamento_id`, [depto]);
    const [{ usuario_id }] = await q(`INSERT INTO usuarios (correo_electronico, contrasena_hash, tipo_rol, estado_cuenta, correo_verificado) VALUES ($1, $2, $3, 'Activo', true) RETURNING usuario_id`, [email, hash, rol]);
    await q(`INSERT INTO perfiles_usuarios (usuario_id, nombre_razon_social, telefono_whatsapp, departamento_id) VALUES ($1, $2, '88880000', $3)`, [usuario_id, nombre, departamento_id]);
    if (rol === 'Proveedor') await q(`INSERT INTO proveedores (usuario_id, nombre_comercial) VALUES ($1, $2)`, [usuario_id, nombre]);
    if (rol === 'Emprendedor') await q(`INSERT INTO emprendedores (usuario_id, nombre_marca) VALUES ($1, $2)`, [usuario_id, nombre]);
    if (rol === 'Administrador') await q(`INSERT INTO administradores (usuario_id) VALUES ($1)`, [usuario_id]);
    return usuario_id;
}

// Resultado del formulario de registro: éxito, o el límite de registros por hora
async function resultadoRegistro(p, email, rol, nombre, depto) {
    const msg = p.dialogos.join(' ');
    if (/xito/.test(msg)) return msg.slice(0, 160);
    if (/demasiadas cuentas/i.test(msg)) {
        await crearCuentaEnBase(email, rol, nombre, depto);
        return `Límite de registros por hora alcanzado (protección funcionando): "${msg.slice(0, 90)}". La cuenta se creó directo en la base para seguir.`;
    }
    throw new Error(`Sin mensaje de éxito: ${msg}`);
}

const tokenDe = (p) => p.pagina.evaluate(() => localStorage.getItem('token'));

// ----------------------------------------------------------------- el recorrido
const cuentas = { prov: correo('proveedor'), emp1: correo('emprendedor1'), emp2: correo('emprendedor2'), admin: correo('admin') };
let ofertaId = null;
let subastaId = null;
let categoriaCreada = null;

try {
    for (const nombre of ['Visitante', 'Proveedor', 'Emprendedor 2', 'Admin']) await abrirPersona(nombre);
    const emp1 = await abrirPersona('Emprendedor 1');

    // 1. Portada y registro
    await paso('Visitante', 'Portada', 'La portada carga con sus estadísticas y botones de sesión.', async (pg) => {
        await ir(pg, '/');
        return await pg.title();
    });

    await paso('Proveedor', 'Registro de proveedor', 'Se llena unirse.html como Proveedor y se envía.', async (pg, p) => {
        await ir(pg, '/unirse.html');
        await pg.click('#optProveedor');
        await pg.fill('#nombreNegocio', 'Curtiembre Recorrido');
        await pg.fill('#correo', cuentas.prov);
        await pg.fill('#telefono', '88880000');
        await pg.fill('#deptoId', 'León');
        await pg.fill('#nombreComercial', 'Cueros Recorrido');
        await pg.fill('#tipoMateriaPrimaPrincipal', 'Cuero vacuno');
        await pg.fill('#password', CLAVE);
        await pg.fill('#confirmPassword', CLAVE);
        await pg.click('#registerForm button[type="submit"]');
        await pg.waitForTimeout(3500);
        return resultadoRegistro(p, cuentas.prov, 'Proveedor', 'Curtiembre Recorrido', 'León');
    });

    await paso('Emprendedor 1', 'Registro de emprendedor', 'Se llena unirse.html como Emprendedor y se envía.', async (pg, p) => {
        await ir(pg, '/unirse.html');
        await pg.click('#optEmprendedor');
        await pg.fill('#nombreNegocio', 'Zapatería Recorrido');
        await pg.fill('#correo', cuentas.emp1);
        await pg.fill('#telefono', '88881111');
        await pg.fill('#deptoId', 'Managua');
        await pg.fill('#nombreMarca', 'Calzado Recorrido');
        await pg.fill('#password', CLAVE);
        await pg.fill('#confirmPassword', CLAVE);
        await pg.click('#registerForm button[type="submit"]');
        await pg.waitForTimeout(3500);
        return resultadoRegistro(p, cuentas.emp1, 'Emprendedor', 'Zapatería Recorrido', 'Managua');
    });

    // La tercera cuenta directo en la base (el registro por formulario ya se probó dos veces)
    await crearCuentaEnBase(cuentas.emp2, 'Emprendedor', 'Talabartería Recorrido', 'Masaya');

    await paso('Emprendedor 1', 'Login sin confirmar el correo', 'Con la verificación de correo activa, entrar antes de confirmar avisa y ofrece reenviar el enlace.', async (pg, p) => {
        const [u] = await q(`SELECT correo_verificado FROM usuarios WHERE correo_electronico = $1`, [cuentas.emp1]);
        if (u?.correo_verificado) return 'No aplica en esta corrida: la cuenta se creó ya confirmada (límite de registros por hora).';
        await ir(pg, '/login.html');
        await pg.fill('#login-email', cuentas.emp1);
        await pg.fill('#login-password', CLAVE);
        await pg.click('#btn-submit-login');
        await pg.waitForTimeout(2500);
        return (p.dialogos.join(' ') || (await pg.locator('body').innerText()).match(/confirma[^.\n]*/i)?.[0] || '').slice(0, 160);
    }, { esperados: ['/api/login'] });

    // Los enlaces de confirmación no llegan a example.com: se confirman en la base
    await q(`UPDATE usuarios SET correo_verificado = true, token_verificacion = NULL WHERE correo_electronico LIKE $1`, [`${PREFIJO}-%`]);
    // Admin temporal (solo para este recorrido)
    await crearCuentaEnBase(cuentas.admin, 'Administrador', 'Admin del recorrido', 'Managua');

    // 2. Mercado: publicar, editar, buscar, mapa
    await paso('Proveedor', 'Login del proveedor', 'Entra con su correo ya confirmado y llega a la portada con su menú.', async (pg) => {
        await iniciarSesionUI(pg, cuentas.prov);
        return pg.url().replace(BASE, '');
    });

    await paso('Proveedor', 'Formulario de publicación', 'Abre "Publicar material", llena los datos y adjunta 2 fotos.', async (pg) => {
        await ir(pg, '/mercado.html');
        await pg.click('#btn-publicar-modal');
        await pg.waitForSelector('#modalOferta', { state: 'visible' });
        await pg.fill('#ofertaTitulo', 'Cuero vacuno café del recorrido');
        await pg.selectOption('#ofertaCategoria', { index: 1 });
        await pg.fill('#ofertaPrecio', '520');
        await pg.fill('#ofertaUnidad', 'por pie²');
        await pg.fill('#ofertaDistancia', '15');
        await pg.fill('#ofertaDescripcion', 'Cuero vacuno curtido al vegetal, color café, ideal para botas y bolsos.');
        await pg.setInputFiles('#inputFotos', FOTOS);
        await pg.waitForTimeout(1500);
        return `${await pg.locator('#previewGrid img').count()} fotos listas`;
    });

    await paso('Proveedor', 'Completar con IA', 'Con la foto adjunta, "Completar con IA" (Gemini) propone título, descripción, categoría y unidad (la descripción se borra antes para ver que la escribe la IA).', async (pg) => {
        await pg.click('#btnIaDescribir');
        await pg.fill('#ofertaDescripcion', '');
        await pg.waitForFunction(() => /Listo|no está disponible|No se pudo/i.test(document.getElementById('resultadoIA').innerText), null, { timeout: 60000 });
        const aviso = await pg.locator('#resultadoIA').innerText();
        if (!/Listo/.test(aviso)) throw new Error(aviso.slice(0, 200));
        const propuesta = await pg.inputValue('#ofertaTitulo');
        const descripcion = await pg.inputValue('#ofertaDescripcion');
        await pg.locator('#ofertaTitulo').scrollIntoViewIfNeeded();
        return `Propuesta de la IA: "${propuesta}" · ${descripcion.slice(0, 120)}`;
    }, { esperados: ['/api/ia/publicacion'] });

    await paso('Proveedor', 'Asistente de precio', 'Pide al asistente un precio sugerido para la categoría (con Gemini si hay publicaciones para comparar; si no, avisa que aún no hay datos).', async (pg) => {
        // Se vuelve a poner el título del recorrido (lo busca un paso posterior)
        await pg.fill('#ofertaTitulo', 'Cuero vacuno café del recorrido');
        await pg.fill('#ofertaUnidad', 'por pie²');
        await pg.click('#btnIaPrecio');
        await pg.waitForTimeout(3000);
        return (await pg.locator('#resultadoIA').innerText()).slice(0, 200);
    });

    await paso('Proveedor', 'Publicar con fotos', 'Guarda la publicación: sube las fotos a Vercel Blob y abre su subasta de 7 días.', async (pg, p) => {
        await pg.click('#btnGuardarOferta');
        await pg.waitForTimeout(6000);
        await pg.waitForLoadState('networkidle');
        const msg = p.dialogos.join(' ');
        if (!/publicado/i.test(msg)) throw new Error(`Sin confirmación: ${msg}`);
        const [o] = await q(`SELECT o.oferta_id, (SELECT count(*)::int FROM fotos_ofertas f WHERE f.oferta_id = o.oferta_id) fotos FROM ofertas o JOIN usuarios u ON u.usuario_id = o.proveedor_id WHERE u.correo_electronico = $1`, [cuentas.prov]);
        ofertaId = o.oferta_id;
        const [s] = await q(`SELECT subasta_id FROM subastas WHERE oferta_id = $1`, [ofertaId]);
        subastaId = s.subasta_id;
        if (o.fotos !== 2) throw new Error(`Se esperaban 2 fotos y hay ${o.fotos}`);
        await pg.locator(`.btn-fav[data-fav="${ofertaId}"], [onclick*="abrirModalEdicion(${ofertaId})"]`).first().scrollIntoViewIfNeeded().catch(() => {});
        return `${msg.slice(0, 80)} · oferta #${ofertaId}, subasta #${subastaId}, 2 fotos`;
    });

    await paso('Proveedor', 'Editar la publicación', 'Abre "Editar" y baja el precio a C$480.', async (pg, p) => {
        await pg.click(`[onclick="abrirModalEdicion(${ofertaId})"]`);
        await pg.waitForSelector('#modalOferta', { state: 'visible' });
        await pg.fill('#ofertaPrecio', '480');
        await pg.click('#btnGuardarOferta');
        await pg.waitForTimeout(4000);
        const [o] = await q(`SELECT precio FROM ofertas WHERE oferta_id = $1`, [ofertaId]);
        if (Number(o.precio) !== 480) throw new Error(`El precio quedó en ${o.precio}`);
        return p.dialogos.join(' ').slice(0, 120) || 'Precio actualizado a C$480';
    });

    await paso('Proveedor', 'Búsqueda sin acentos', 'En el Mercado, buscar "VACUNO CAFE" (sin tilde, en mayúsculas) encuentra "vacuno café".', async (pg) => {
        await ir(pg, '/mercado.html');
        await pg.fill('#searchInput', 'VACUNO CAFE');
        await pg.press('#searchInput', 'Enter');
        await pg.waitForTimeout(2500);
        const texto = await pg.locator('#contenedor-ofertas').innerText();
        if (!/recorrido/i.test(texto)) throw new Error('La publicación no apareció en la búsqueda');
        return 'Encontrada';
    });

    await paso('Proveedor', 'Mapa de proveedores', 'La pestaña Mapa muestra a los proveedores por departamento.', async (pg) => {
        await pg.click(".tab[onclick*=\"'map'\"]");
        await pg.waitForTimeout(3500);
        return (await pg.locator('#mapa-resumen').innerText().catch(() => '')).slice(0, 160);
    });

    // 3. Favoritos, alerta y subastas
    await paso('Emprendedor 1', 'Login del emprendedor', 'Entra con su cuenta.', async (pg) => {
        await iniciarSesionUI(pg, cuentas.emp1);
        return pg.url().replace(BASE, '');
    });

    await paso('Emprendedor 1', 'Guardar en favoritos', 'Toca el corazón de la publicación y la ve en la pestaña Favoritos.', async (pg) => {
        await ir(pg, '/mercado.html');
        await pg.click(`.btn-fav[data-fav="${ofertaId}"]`);
        await pg.waitForTimeout(1500);
        await pg.click(".tab[onclick*=\"'favorites'\"]");
        await pg.waitForTimeout(2500);
        const texto = await pg.locator('#contenedor-favoritos').innerText();
        if (!/recorrido/i.test(texto)) throw new Error('No aparece en Favoritos');
        return 'En favoritos';
    });

    await paso('Emprendedor 1', 'Crear alerta de búsqueda', 'Crea la alerta "suela" para que le avisen cuando publiquen algo así.', async (pg) => {
        await pg.fill('#alertaPalabra', 'suela');
        await pg.click('#btnGuardarAlerta');
        await pg.waitForTimeout(2000);
        return (await pg.locator('#lista-alertas').innerText()).slice(0, 120);
    });

    await paso('Emprendedor 2', 'Subastas abiertas', 'El emprendedor 2 entra y deja abierta la pestaña Subastas.', async (pg) => {
        await iniciarSesionUI(pg, cuentas.emp2);
        await ir(pg, '/mercado.html');
        await pg.click(".tab[onclick*=\"'auctions'\"]");
        await pg.waitForSelector(`#subasta-input-${subastaId}`, { timeout: 15000 });
        await pg.waitForTimeout(2000);
        return (await pg.locator('#indicador-en-vivo').innerText().catch(() => '')).trim() || 'Subastas cargadas';
    });

    const pujar = async (pg, monto) => {
        await pg.fill(`#subasta-input-${subastaId}`, String(monto));
        await pg.click(`[onclick^="ejecutarPujaReal(${subastaId}"]`);
        await pg.waitForTimeout(3000);
    };

    await paso('Emprendedor 1', 'Pujar', 'El emprendedor 1 puja C$550 en la subasta.', async (pg, p) => {
        await ir(pg, '/mercado.html');
        await pg.click(".tab[onclick*=\"'auctions'\"]");
        await pg.waitForSelector(`#subasta-input-${subastaId}`, { timeout: 15000 });
        await pujar(pg, 550);
        if (!/aceptada/i.test(p.dialogos.join(' '))) throw new Error(`Sin confirmación: ${p.dialogos.join(' ')}`);
        return p.dialogos.join(' ').slice(0, 100);
    });

    await paso('Emprendedor 2', 'Puja en vivo (Ably)', 'Sin recargar, la tarjeta del emprendedor 2 ya muestra C$550: llegó por tiempo real.', async (pg) => {
        await pg.waitForFunction((id) => /550/.test(document.getElementById(`subasta-val-${id}`)?.textContent || ''), subastaId, { timeout: 15000 });
        await pg.locator(`#subasta-val-${subastaId}`).scrollIntoViewIfNeeded();
        return (await pg.locator(`#subasta-val-${subastaId}`).innerText()).trim();
    });

    await paso('Emprendedor 2', 'Superar la puja', 'El emprendedor 2 puja C$600.', async (pg, p) => {
        await pujar(pg, 600);
        if (!/aceptada/i.test(p.dialogos.join(' '))) throw new Error(`Sin confirmación: ${p.dialogos.join(' ')}`);
        return p.dialogos.join(' ').slice(0, 100);
    });

    await paso('Emprendedor 1', 'Campana: "Te superaron"', 'Al emprendedor 1 le llega la notificación en vivo; se abre la campana.', async (pg) => {
        await pg.waitForTimeout(3000);
        const campana = pg.locator('.campana-ent').first();
        await campana.click({ timeout: 8000 });
        await pg.waitForTimeout(1500);
        const texto = await pg.locator('body').innerText();
        if (!/superaron/i.test(texto)) throw new Error('No aparece "Te superaron"');
        return 'Notificación "Te superaron" visible';
    });

    // 4. Chat en vivo
    await paso('Proveedor', 'Chat abierto (proveedor)', 'El proveedor abre el chat y espera.', async (pg) => {
        await ir(pg, '/chat.html');
        return 'Chat abierto';
    });

    await paso('Emprendedor 1', 'Enviar un mensaje', 'El emprendedor 1 abre la conversación con el proveedor y le escribe.', async (pg) => {
        await ir(pg, '/chat.html');
        const provId = (await q(`SELECT usuario_id FROM usuarios WHERE correo_electronico = $1`, [cuentas.prov]))[0].usuario_id;
        await pg.click(`#contacto-${provId}`);
        await pg.fill('#chat-text', '¡Hola! ¿El cuero café tiene 1.8 mm de grosor?');
        await pg.press('#chat-text', 'Enter');
        await pg.waitForTimeout(2500);
        const texto = await pg.locator('#chat-msgs').innerText();
        if (!/1\.8 mm/.test(texto)) throw new Error('El mensaje no aparece en la conversación');
        return 'Mensaje enviado';
    });

    await paso('Proveedor', 'Mensaje en vivo', 'Al proveedor le aparece el contador de no leídos sin recargar; abre la conversación.', async (pg) => {
        const empId = (await q(`SELECT usuario_id FROM usuarios WHERE correo_electronico = $1`, [cuentas.emp1]))[0].usuario_id;
        await pg.waitForTimeout(3000);
        await pg.click(`#contacto-${empId}`);
        await pg.waitForTimeout(2500);
        const texto = await pg.locator('#chat-msgs').innerText();
        if (!/1\.8 mm/.test(texto)) throw new Error('El mensaje no llegó');
        return 'Mensaje recibido';
    });

    // 5. Cierre, trato, calificación, comprobante, perfil público
    const tokenAdmin = (await api('POST', '/api/login', { body: { email: cuentas.admin, password: CLAVE } })).data?.token;
    await q(`UPDATE subastas SET fecha_fin = now() - interval '1 minute' WHERE subasta_id = $1`, [subastaId]);
    const cierre = await api('POST', '/api/admin/subastas/cerrar-vencidas', { token: tokenAdmin });

    await paso('Emprendedor 2', 'Ganar la subasta', 'Al cerrar la subasta, el ganador ve el trato en su dashboard.', async (pg) => {
        if (cierre.status !== 200 || !cierre.data?.cerradas?.some((c) => c.subastaId === subastaId)) throw new Error(`Cierre: ${JSON.stringify(cierre)}`);
        await ir(pg, '/dashboard.html');
        await pg.waitForTimeout(2500);
        const trato = pg.locator('[data-trato]').first();
        await trato.scrollIntoViewIfNeeded();
        return (await trato.innerText()).replace(/\s+/g, ' ').slice(0, 160);
    });

    await paso('Proveedor', 'Completar el trato', 'El proveedor marca el trato como completado desde su dashboard.', async (pg, p) => {
        await ir(pg, '/dashboard.html');
        await pg.waitForTimeout(2500);
        await pg.locator(`[onclick*="cambiarEstadoTrato"][onclick*="'Completado'"]`).first().click();
        await pg.waitForTimeout(3000);
        return (p.dialogos.join(' ') || 'Completado').slice(0, 120);
    });

    await paso('Emprendedor 2', 'Calificar al proveedor', 'El ganador da 5 estrellas con un comentario.', async (pg, p) => {
        p.respuestaPrompt = 'Excelente cuero, entrega puntual';
        await ir(pg, '/dashboard.html');
        await pg.waitForTimeout(2500);
        await pg.locator('.trato-estrellas .estrella').first().click();
        await pg.waitForTimeout(3000);
        const [c] = await q(`SELECT puntuacion FROM calificaciones c JOIN tratos_cerrados t ON t.trato_id = c.trato_id WHERE t.origen_id = $1`, [subastaId]);
        if (!c) throw new Error('No se guardó la calificación');
        return `${c.puntuacion} estrellas`;
    });

    await paso('Emprendedor 2', 'Comprobante del trato', 'El comprobante para imprimir o guardar como PDF.', async (pg) => {
        const [t] = await q(`SELECT trato_id FROM tratos_cerrados WHERE origen_id = $1 AND tipo_origen = 'Subasta'`, [subastaId]);
        await ir(pg, `/comprobante.html?trato=${t.trato_id}`);
        await pg.waitForTimeout(2000);
        return (await pg.locator('body').innerText()).match(/EL-\d+/)?.[0] || '';
    });

    await paso('Visitante', 'Perfil público del proveedor', 'Sin sesión: el perfil público con su calificación y reseñas.', async (pg) => {
        const provId = (await q(`SELECT usuario_id FROM usuarios WHERE correo_electronico = $1`, [cuentas.prov]))[0].usuario_id;
        await ir(pg, `/perfil-publico.html?id=${provId}`);
        await pg.waitForTimeout(2000);
        return (await pg.locator('body').innerText()).match(/★[^\n]*|5[.,]0[^\n]*/)?.[0]?.slice(0, 80) || '';
    });

    // 6. Dashboard y reportes
    await paso('Proveedor', 'Dashboard del proveedor', 'Estadísticas, gráficas y su actividad (1 subasta vendida).', async (pg) => {
        await ir(pg, '/dashboard.html');
        await pg.waitForTimeout(3000);
        return '';
    });

    await paso('Proveedor', 'Reportes', 'El reporte de ventas del proveedor carga con sus gráficas.', async (pg) => {
        await ir(pg, '/reportes.html');
        await pg.waitForTimeout(4000);
        const texto = await pg.locator('body').innerText();
        if (/No se pudo cargar/i.test(texto)) throw new Error('El reporte no cargó');
        return '';
    });

    await paso('Proveedor', 'Descargar Excel y PDF', 'Excel descarga el archivo .xlsx; PDF abre la ventana de imprimir del navegador (ahí se guarda como PDF).', async (pg) => {
        const [descarga] = await Promise.all([pg.waitForEvent('download', { timeout: 40000 }), pg.click('#btnExcel')]);
        await pg.evaluate(() => { window.__imprimio = false; window.print = () => { window.__imprimio = true; }; });
        await pg.click('#btnPdf');
        await pg.waitForFunction(() => window.__imprimio === true, null, { timeout: 15000 });
        return `${descarga.suggestedFilename()} y la vista para imprimir o guardar como PDF`;
    });

    // 7. Kan
    await paso('Emprendedor 1', 'Kan, el asistente', 'Se abre el widget de Kan y se le pregunta cómo funcionan las pujas (respuesta fija, sin gastar IA).', async (pg) => {
        await ir(pg, '/index.html');
        await pg.click('.kan-widget-btn');
        await pg.fill('.kan-input', '¿Cómo funcionan las pujas en las subastas?');
        await pg.press('.kan-input', 'Enter');
        await pg.waitForTimeout(5000);
        const texto = await pg.locator('.kan-chat-window').innerText();
        if (!/puja/i.test(texto)) throw new Error('Kan no respondió');
        return 'Kan respondió';
    });

    await paso('Emprendedor 1', 'Kan con Gemini', 'Una pregunta abierta, sin respuesta fija: la contesta Gemini con el inventario real del mercado.', async (pg) => {
        const antes = await pg.locator('.kan-chat-window').innerText();
        await pg.fill('.kan-input', '¿Qué cuero me recomiendas para hacer billeteras resistentes?');
        await pg.press('.kan-input', 'Enter');
        await pg.waitForFunction((n) => document.querySelector('.kan-chat-window').innerText.length > n + 150, antes.length + 60, { timeout: 60000 });
        await pg.waitForTimeout(1500);
        const texto = (await pg.locator('.kan-chat-window').innerText()).slice(antes.length);
        if (/problemas temporales/i.test(texto)) throw new Error('Kan respondió con el mensaje de respaldo (Gemini no contestó)');
        await pg.evaluate(() => { const w = document.querySelector('.kan-chat-window [class*="mensajes"], .kan-chat-window'); w.scrollTop = w.scrollHeight; });
        return texto.replace(/\s+/g, ' ').trim().slice(0, 220);
    });

    await paso('Emprendedor 1', 'Kan sigue al cambiar de página', 'Se va al Mercado: la ventana de Kan sigue abierta con la conversación de la portada.', async (pg) => {
        await ir(pg, '/mercado.html');
        await pg.waitForSelector('.kan-chat-window.active', { timeout: 10000 });
        const texto = await pg.locator('.kan-chat-window').innerText();
        if (!/billeteras resistentes/i.test(texto)) throw new Error('La conversación no se conservó');
        const mensajes = await pg.locator('.kan-msg.user').count();
        return `${mensajes} preguntas conservadas`;
    });

    await paso('Emprendedor 1', 'Kan recuerda lo hablado', 'Pregunta "¿Y cuánto cuesta ese?" sin decir cuál: Kan usa la conversación anterior para entenderla.', async (pg) => {
        const antes = (await pg.locator('.kan-chat-window').innerText()).length;
        await pg.fill('.kan-input', '¿Y cuánto cuesta ese?');
        await pg.press('.kan-input', 'Enter');
        await pg.waitForFunction((n) => document.querySelector('.kan-chat-window').innerText.length > n + 120, antes + 30, { timeout: 60000 });
        await pg.waitForTimeout(1500);
        const texto = (await pg.locator('.kan-chat-window').innerText()).slice(antes);
        if (/problemas temporales/i.test(texto)) throw new Error('Kan respondió con el mensaje de respaldo (Gemini no contestó)');
        return texto.replace(/\s+/g, ' ').trim().slice(0, 220);
    });

    await paso('Emprendedor 1', 'Cerrar sesión borra a Kan', 'Cierra sesión y vuelve a entrar: el chat de Kan empieza de nuevo, sin la conversación anterior.', async (pg) => {
        await Promise.all([pg.waitForURL(/login\.html/, { timeout: 20000 }), pg.evaluate(() => window.cerrarSesion())]);
        await iniciarSesionUI(pg, cuentas.emp1);
        await pg.click('.kan-widget-btn');
        await pg.waitForSelector('.kan-chat-window.active');
        const preguntas = await pg.locator('.kan-msg.user').count();
        if (preguntas !== 0) throw new Error(`Quedaron ${preguntas} preguntas de la sesión anterior`);
        return 'Chat limpio después de volver a iniciar sesión';
    });

    // 8. Panel de admin
    await paso('Admin', 'Panel de administrador', 'El admin ve las métricas y la lista de usuarios.', async (pg) => {
        await iniciarSesionUI(pg, cuentas.admin);
        await pg.waitForTimeout(3000);
        return (await pg.locator('#kpi-usuarios').innerText().catch(() => '')).trim() + ' usuarios';
    });

    await paso('Admin', 'Buscar y suspender', 'Busca las cuentas del recorrido y suspende al emprendedor 1.', async (pg) => {
        await pg.fill('#buscarUsuario', PREFIJO);
        await pg.waitForTimeout(2500);
        const empId = (await q(`SELECT usuario_id FROM usuarios WHERE correo_electronico = $1`, [cuentas.emp1]))[0].usuario_id;
        await pg.locator(`select[onchange^="cambiarEstadoUsuario(${empId}"]`).selectOption('Suspendido');
        await pg.waitForTimeout(2500);
        const [u] = await q(`SELECT estado_cuenta FROM usuarios WHERE usuario_id = $1`, [empId]);
        if (u.estado_cuenta !== 'Suspendido') throw new Error(`Quedó ${u.estado_cuenta}`);
        return 'Emprendedor 1 suspendido';
    });

    await paso('Emprendedor 1', 'Cuenta suspendida', 'Al recargar, la cuenta suspendida ya no puede usar la API (403).', async (pg) => {
        const r = await api('GET', '/api/notificaciones', { token: await tokenDe(emp1) });
        await ir(pg, '/dashboard.html', 'load');
        await pg.waitForTimeout(3000);
        if (r.status !== 403) throw new Error(`Respondió ${r.status}`);
        return 'La API responde 403: "Tu cuenta ha sido suspendida"';
    }, { esperados: ['/api/'] });

    await paso('Admin', 'Crear una categoría', 'El admin crea una categoría nueva.', async (pg, p) => {
        await pg.fill('#catNombre', `Categoría ${PREFIJO}`);
        await pg.fill('#catDesc', 'Creada por el recorrido (se borra al final)');
        await pg.click('form[onsubmit^="crearCategoria"] button[type="submit"]');
        await pg.waitForTimeout(2500);
        const [c] = await q(`SELECT categoria_id FROM categorias_materiales WHERE nombre_categoria = $1`, [`Categoría ${PREFIJO}`]);
        if (!c) throw new Error('No se creó');
        categoriaCreada = c.categoria_id;
        return (p.dialogos.join(' ') || 'Creada').slice(0, 100);
    });

    // 9. Recuperar contraseña y confirmar correo
    await paso('Visitante', 'Recuperar la contraseña', 'Pedir el enlace responde lo mismo exista o no la cuenta.', async (pg) => {
        await ir(pg, '/restablecer.html');
        const campo = pg.locator('input[type="email"]').first();
        await campo.fill(cuentas.emp2);
        await campo.press('Enter');
        await pg.waitForTimeout(3000);
        return (await pg.locator('body').innerText()).match(/Si el correo[^.]*\./)?.[0] || '';
    });

    await paso('Visitante', 'Enlace de confirmación vencido', 'verificar.html con un enlace inválido explica qué hacer.', async (pg) => {
        await ir(pg, `/verificar.html?token=${'a'.repeat(64)}`);
        await pg.waitForTimeout(2000);
        return (await pg.locator('body').innerText()).match(/no es válido[^.]*\./)?.[0] || '';
    }, { esperados: ['/api/verificar-correo'] });

    await paso('Visitante', 'Documentación de la API', '/api/docs muestra Swagger UI.', async (pg) => {
        await ir(pg, '/api/docs');
        await pg.waitForSelector('.swagger-ui .info', { timeout: 20000 });
        return '';
    });
} catch (err) {
    console.error('❌ El recorrido se detuvo:', err.message);
    pasos.push({ numero: ++numero, persona: '-', titulo: 'Recorrido detenido', descripcion: err.message, ok: false, detalle: err.message, dialogos: [], errores: [], archivo: null });
} finally {
    // ------------------------------------------------------------- limpieza
    const limpieza = [];
    try {
        const tokenAdmin = (await api('POST', '/api/login', { body: { email: cuentas.admin, password: CLAVE } })).data?.token;
        const temporales = await q(`SELECT usuario_id, correo_electronico FROM usuarios WHERE correo_electronico LIKE $1 AND correo_electronico <> $2`, [`${PREFIJO}-%`, cuentas.admin]);
        const fotos = await q(`SELECT f.foto_url FROM fotos_ofertas f JOIN ofertas o ON o.oferta_id = f.oferta_id JOIN usuarios u ON u.usuario_id = o.proveedor_id WHERE u.correo_electronico LIKE $1`, [`${PREFIJO}-%`]);
        for (const u of temporales) {
            const r = tokenAdmin ? await api('DELETE', `/api/admin/usuarios/${u.usuario_id}`, { token: tokenAdmin }) : { status: 0 };
            if (r.status !== 200) await q(`DELETE FROM usuarios WHERE usuario_id = $1`, [u.usuario_id]).catch(() => {});
            limpieza.push(`${u.correo_electronico}: ${r.status === 200 ? 'borrada por la API' : `API ${r.status}`}`);
        }
        if (categoriaCreada) await q(`DELETE FROM categorias_materiales WHERE categoria_id = $1`, [categoriaCreada]);
        await q(`DELETE FROM usuarios WHERE correo_electronico = $1`, [cuentas.admin]);
        await esperar(3000);
        const restantes = await q(`SELECT count(*)::int n FROM usuarios WHERE correo_electronico LIKE $1`, [`${PREFIJO}-%`]);
        const fotosVivas = [];
        for (const f of fotos) {
            const r = await fetch(f.foto_url, { method: 'HEAD' }).catch(() => ({ status: 0 }));
            if (r.status === 200) fotosVivas.push(f.foto_url);
        }
        limpieza.push(`Cuentas del recorrido que quedan: ${restantes[0].n}`);
        limpieza.push(`Fotos subidas: ${fotos.length}; todavía accesibles: ${fotosVivas.length}`);
    } catch (err) {
        limpieza.push(`❌ Error en la limpieza: ${err.message}`);
    }
    await navegador.close();
    await pool.end();
    const resumen = { base: BASE, prefijo: PREFIJO, fecha: new Date().toISOString(), pasos, limpieza };
    fs.writeFileSync(path.join(SALIDA, 'resultado.json'), JSON.stringify(resumen, null, 2));
    const fallidos = pasos.filter((p) => !p.ok).length;
    console.log(`\nLimpieza:\n  ${limpieza.join('\n  ')}`);
    console.log(`\nRESULTADO: ${pasos.length - fallidos} pasos bien, ${fallidos} con problemas · capturas en ${SALIDA}`);
    process.exit(fallidos ? 1 : 0);
}
