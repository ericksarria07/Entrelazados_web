// ==========================================================================
// PRUEBA DE LA CLAVE DE GEMINI (la que usa Kan)
//
// Lee GEMINI_API_KEY y GEMINI_MODELO del .env de entrelazados-api y hace una
// pregunta corta. Sirve para comprobar una clave nueva antes de reiniciar PM2.
//
// Uso (desde la carpeta del proyecto):
//   node backend/scripts/probar_gemini.js
// La clave nunca se muestra completa: solo sus últimos 4 caracteres.
// ==========================================================================
const path = require('path');
const API = path.join(__dirname, '..', 'entrelazados-api');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(API, '.env'), quiet: true });
const { GoogleGenAI } = require(path.join(__dirname, '..', 'node_modules', '@google', 'genai'));

const clave = (process.env.GEMINI_API_KEY || '').trim();
const modelo = (process.env.GEMINI_MODELO || '').trim() || 'gemini-3.8-flash';

(async () => {
    if (!clave) {
        console.error('❌ GEMINI_API_KEY está vacía en entrelazados-api/.env');
        process.exit(1);
    }
    console.log(`Clave: ****${clave.slice(-4)} · Modelo: ${modelo}`);
    try {
        const ai = new GoogleGenAI({ apiKey: clave });
        const respuesta = await ai.models.generateContent({
            model: modelo,
            contents: 'Responde solo con la palabra: listo',
            config: { maxOutputTokens: 20 }
        });
        console.log(`✅ Gemini respondió: ${String(respuesta.text || '').trim() || '(respuesta vacía)'}`);
        console.log('   Ya puedes reiniciar el servidor: pm2 restart 0 --update-env');
    } catch (error) {
        const texto = String(error && error.message || error);
        if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(texto)) {
            console.error('❌ Google rechazó la clave. Revisa que la copiaste completa desde https://aistudio.google.com/apikey');
        } else if (/not found|404|is not supported/i.test(texto)) {
            console.error(`❌ El modelo "${modelo}" no existe o no está disponible para esta clave. Cambia GEMINI_MODELO en el .env.`);
        } else {
            console.error('❌ No se pudo consultar Gemini:', texto.slice(0, 300));
        }
        process.exit(1);
    }
})();
