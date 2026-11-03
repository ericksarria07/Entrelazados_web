// ==========================================================================
// CONFIGURACIÓN
//
// Lee el .env UNA sola vez y entrega los valores ya revisados al resto del
// servidor. Ningún otro archivo debería leer process.env para algo que esté aquí.
// El .env se busca junto a este archivo, sin importar desde qué carpeta se
// inicie el servidor (PM2, systemd...). Ver .env.example.
// ==========================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const VARIABLES_REQUERIDAS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET'];
const faltantes = VARIABLES_REQUERIDAS.filter(v => !process.env[v]);
if (faltantes.length > 0) {
    console.error(`❌ Faltan variables en el archivo .env: ${faltantes.join(', ')}`);
    process.exit(1);
}

const texto = (nombre) => (process.env[nombre] || '').trim();
const quitarBarraFinal = (url) => url.replace(/\/+$/, '');
const intervaloCierre = Number(process.env.INTERVALO_CIERRE_SUBASTAS_SEG);

module.exports = {
    puerto: process.env.PORT || 3000,

    db: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    },

    jwtSecreto: process.env.JWT_SECRET,
    duracionSesion: '8h',
    rondasBcrypt: 10,

    // Dirección pública del sitio para los enlaces de los correos (p. ej. https://entrelazados.com).
    // Vacía: se usa la dirección con la que llegó la petición.
    urlPublica: quitarBarraFinal(texto('APP_URL')),

    // VERIFICAR_CORREO: '1' siempre, '0' nunca, '' solo si el correo está configurado (ver app.js)
    modoVerificacionCorreo: texto('VERIFICAR_CORREO'),

    gemini: {
        clave: texto('GEMINI_API_KEY'),
        // Para probar la clave y el modelo: node backend/scripts/probar_gemini.js
        modelo: texto('GEMINI_MODELO') || 'gemini-3.8-flash'
    },

    // Cada cuántos segundos se buscan subastas vencidas (mínimo 10, por defecto 60)
    intervaloCierreSubastasSeg: Number.isInteger(intervaloCierre) && intervaloCierre >= 10 ? intervaloCierre : 60,

    // Solo si algún día se pone nginx delante: TRUST_PROXY=1 para que req.ip sea la IP real
    trustProxy: process.env.TRUST_PROXY ? (Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY) : null,

    // Las páginas salen de este mismo servidor; si otro sitio necesitara la API, se lista aquí
    origenesCors: texto('CORS_ORIGENES').split(',').map(o => o.trim()).filter(Boolean)
};
