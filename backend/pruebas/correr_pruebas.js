// ==========================================================================
// CORRER LAS PRUEBAS DE INTEGRACIÓN DE LA API CON UN SOLO COMANDO
//
//   Desde backend/:   CLAVE_PRUEBAS=UNA_CLAVE_DE_PRUEBA npm run test:api
//   (o bien)          node pruebas/correr_pruebas.js UNA_CLAVE_DE_PRUEBA
//   (npm test corre primero las pruebas unitarias y después estas)
//
// 1. Vacía la base LOCAL entrelazados_pruebas y carga el esquema (sql/esquema_mysql.sql).
// 2. Levanta el servidor en el puerto 3055 apuntando a esa base.
// 3. Corre pruebas_api.js y apaga el servidor.
// Solo toca la base entrelazados_pruebas de esta computadora: nunca la de producción.
// La base y el usuario se crean una sola vez (ver pruebas/LEEME.md, paso 1).
// PRUEBAS_DB_HOST cambia el servidor MySQL (por defecto localhost; GitHub Actions usa 127.0.0.1).
// ==========================================================================
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const BACKEND = path.join(__dirname, '..');
const API = path.join(BACKEND, 'entrelazados-api');
const mysql = require(path.join(BACKEND, 'node_modules', 'mysql2', 'promise'));

const BASE = 'entrelazados_pruebas';
const PUERTO = 3055;
const URL_PING = `http://localhost:${PUERTO}/api/ping`;
const clave = process.env.CLAVE_PRUEBAS || process.argv[2];
const CARPETA_FOTOS = path.join(os.tmpdir(), 'entrelazados_uploads_pruebas');
const LOG_SERVIDOR = path.join(os.tmpdir(), 'entrelazados_servidor_pruebas.log');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const responde = () => fetch(URL_PING).then((r) => r.ok, () => false);

async function vaciarBase() {
    const c = await mysql.createConnection({ host: process.env.PRUEBAS_DB_HOST || 'localhost', user: BASE, password: clave, database: BASE });
    const [tablas] = await c.query('SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [BASE]);
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { n } of tablas) await c.query('DROP TABLE `' + n + '`');
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
    await c.end();
}

(async () => {
    if (!clave) {
        console.error('Falta la clave de la base de pruebas: CLAVE_PRUEBAS=... npm test');
        process.exit(2);
    }
    if (await responde()) {
        console.error(`Ya hay un servidor en el puerto ${PUERTO}. Ciérralo antes de correr las pruebas.`);
        process.exit(2);
    }

    console.log(`1/3 Base ${BASE}: se vacía y se carga el esquema...`);
    await vaciarBase();
    const carga = spawnSync(process.execPath,
        [path.join(__dirname, 'cargar_esquema.js'), BACKEND, path.join(BACKEND, 'sql', 'esquema_mysql.sql'), clave],
        { stdio: 'inherit' });
    if (carga.status !== 0) process.exit(1);

    console.log(`2/3 Servidor de pruebas en el puerto ${PUERTO} (log: ${LOG_SERVIDOR})`);
    fs.rmSync(CARPETA_FOTOS, { recursive: true, force: true });
    const log = fs.openSync(LOG_SERVIDOR, 'w');
    const servidor = spawn(process.execPath, ['index.js'], {
        cwd: API,
        stdio: ['ignore', log, log],
        env: {
            ...process.env,
            DB_HOST: process.env.PRUEBAS_DB_HOST || 'localhost', DB_USER: BASE, DB_PASSWORD: clave, DB_NAME: BASE,
            JWT_SECRET: 'secreto-de-pruebas-local', GEMINI_API_KEY: 'sin-clave', PORT: String(PUERTO),
            EMAIL_USER: '', EMAIL_PASS: '', APP_URL: '', VERIFICAR_CORREO: '1',
            UPLOADS_DIR: CARPETA_FOTOS,
            // Las pruebas crean muchas cuentas y hacen cientos de peticiones desde la misma IP
            LIMITE_REGISTRO: '40', LIMITE_RECUPERACION: '30', LIMITE_LOGIN: '30', LIMITE_API: '2000',
            // El cierre de subastas lo disparan las propias pruebas
            INTERVALO_CIERRE_SUBASTAS_SEG: '3600'
        }
    });

    let codigo = 1;
    try {
        for (let i = 0; i < 50 && !(await responde()); i++) await esperar(300);
        if (!(await responde())) throw new Error(`El servidor no arrancó. Revisa ${LOG_SERVIDOR}`);

        console.log('3/3 Pruebas de la API...');
        const pruebas = spawnSync(process.execPath, [path.join(__dirname, 'pruebas_api.js'), BACKEND, clave], { stdio: 'inherit' });
        codigo = pruebas.status ?? 1;
    } catch (err) {
        console.error('❌ ' + err.message);
    } finally {
        servidor.kill();
    }
    process.exit(codigo);
})().catch((err) => {
    console.error('❌ ' + err.message);
    process.exit(1);
});
