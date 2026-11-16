// 2. Inicio de sesión
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('2. Inicio de sesión');
    const sesiones = {};
    for (const [k, email, pass] of [['p1', 'prov1@prueba.com', 'Clave123'], ['p2', 'prov2@prueba.com', 'Clave123'], ['e1', 'emp1@prueba.com', 'Clave123'], ['e2', 'emp2@prueba.com', 'Clave123'], ['admin', 'admin@prueba.com', 'Admin123!']]) {
        r = await ctx.login(email, pass);
        check(`Login ${email}`, r.status === 200 && r.data.token, JSON.stringify(r));
        sesiones[k] = r.data;
    }
    r = await ctx.login('prov1@prueba.com', 'Incorrecta1');
    check('Contraseña incorrecta → 401', r.status === 401);
    r = await ctx.login('noexiste@prueba.com', 'Clave123');
    check('Correo inexistente → 401 (mismo mensaje, no revela si existe)', r.status === 401 && r.data.message === 'Correo o contraseña incorrectos.');
    r = await ctx.login('antiguo@prueba.com', 'clave_vieja');
    check('Usuario antiguo (texto plano) puede entrar', r.status === 200, JSON.stringify(r));
    await new Promise(res => setTimeout(res, 300));
    const filaAnt = (await q(`SELECT contrasena_hash FROM usuarios WHERE correo_electronico = $1`, ['antiguo@prueba.com']))[0];
    check('…y su contraseña se migró automáticamente a bcrypt', /^\$2[aby]\$/.test(filaAnt.ContrasenaHash), filaAnt.ContrasenaHash);
    r = await ctx.login('antiguo@prueba.com', 'clave_vieja');
    check('…y puede volver a entrar con la misma contraseña', r.status === 200);
    ({ p1: ctx.p1, p2: ctx.p2, e1: ctx.e1, e2: ctx.e2, admin: ctx.admin } = sesiones);
}
