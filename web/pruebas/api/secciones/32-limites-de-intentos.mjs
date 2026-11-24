// 15. Límites de intentos
// Límites de web/lib/limites.ts: los contadores viven en la tabla limites_uso de Postgres.
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { B, api, check, q, seccion } from '../contexto.mjs';

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
    const [fila] = await q(`SELECT cuenta, vence > now() AS abierta FROM limites_uso WHERE clave = $1`, [`kanMinuto:u${ctx.e1.id}`]);
    check('…el contador queda en la base (todas las instancias de Vercel cuentan juntas)', fila && fila.cuenta >= 11 && fila.abierta, JSON.stringify(fila));
    // 12 preguntas a la vez del admin, desde un contador en cero: la suma es atómica, pasan exactamente 10
    await q(`DELETE FROM limites_uso WHERE clave = $1`, [`kanMinuto:u${ctx.admin.id}`]);
    const rafaga = await Promise.all(Array.from({ length: 12 }, () => api('POST', '/api/chat/ia', { token: ctx.admin.token, body: { mensajeUsuario: 'hola' } })));
    const pasaron = rafaga.filter((x) => x.status === 200).length;
    check('…con 12 preguntas a la vez no se cuela ninguna de más (pasan 10 de 12)', pasaron === 10 && rafaga.every((x) => [200, 429].includes(x.status)), `pasaron=${pasaron} ${rafaga.map((x) => x.status).join(',')}`);

    limite = await hasta429((i) => ctx.reg(`masivo${i}@prueba.com`, 'Emprendedor'), 50);
    check('Registro: crear cuentas sin parar desde la misma IP → 429', limite.intentos !== null, `intentos=${limite.intentos}`);

    // El cron diario borra los contadores vencidos
    await q(`INSERT INTO limites_uso (clave, cuenta, vence) VALUES ('login:vencido-de-prueba', 3, now() - interval '1 hour')`);
    const cron = await fetch(B + '/api/cron/cerrar-subastas', { headers: { Authorization: 'Bearer secreto-cron-pruebas' } }).then(async (x) => ({ status: x.status, data: await x.json() }));
    const quedan = await q(`SELECT 1 FROM limites_uso WHERE clave = 'login:vencido-de-prueba'`);
    check('El cron diario borra los contadores vencidos (y deja los abiertos)', cron.status === 200 && cron.data.limitesBorrados >= 1 && quedan.length === 0 && (await q(`SELECT 1 FROM limites_uso WHERE clave = $1`, [`kanMinuto:u${ctx.e1.id}`])).length === 1, JSON.stringify(cron));
}
