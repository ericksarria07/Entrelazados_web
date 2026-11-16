// 15. Límites de intentos
// Se revisa en la 1.9 (límites con Upstash): hoy prueba express-rate-limit.
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('15. Límites de intentos');
    const hasta429 = async (peticion, maximo) => {
        for (let i = 1; i <= maximo; i++) {
            const resp = await peticion(i);
            if (resp.status === 429) return { intentos: i, resp };
        }
        return { intentos: null, resp: null };
    };
    let limite = await hasta429(() => ctx.login('noexiste@prueba.com', 'Equivocada1'), 40);
    check('Login: tras varios intentos fallidos responde 429', limite.intentos !== null && limite.intentos <= 31, `intentos=${limite.intentos}`);
    check('…con un mensaje claro y cuánto esperar', limite.resp && /Demasiados intentos fallidos/.test(limite.resp.data.message) && limite.resp.data.reintentarEnSegundos > 0, JSON.stringify(limite.resp && limite.resp.data));
    r = await ctx.login('emp1@prueba.com', 'Clave123');
    check('…y mientras dure el bloqueo tampoco deja probar más contraseñas', r.status === 429);

    limite = await hasta429(() => api('POST', '/api/chat/ia', { token: ctx.e1.token, body: { mensajeUsuario: 'hola' } }), 15);
    check('Kan: más de 10 preguntas por minuto del mismo usuario → 429', limite.intentos !== null && limite.intentos <= 11, `intentos=${limite.intentos}`);
    r = await api('POST', '/api/chat/ia', { token: ctx.admin.token, body: { mensajeUsuario: 'hola' } });
    check('…el límite de Kan es por usuario: otro usuario sigue pudiendo preguntar', r.status === 200);

    limite = await hasta429((i) => ctx.reg(`masivo${i}@prueba.com`, 'Emprendedor'), 50);
    check('Registro: crear cuentas sin parar desde la misma IP → 429', limite.intentos !== null, `intentos=${limite.intentos}`);
}
