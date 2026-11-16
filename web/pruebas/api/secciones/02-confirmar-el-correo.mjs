// 1b. Confirmar el correo (VERIFICAR_CORREO=1)
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('1b. Confirmar el correo (VERIFICAR_CORREO=1)');
    ctx.login = async (email, password) => api('POST', '/api/login', { body: { email, password } });
    const tokenVerif = async (email) => ((await q(`SELECT token_verificacion FROM usuarios WHERE correo_electronico = $1`, [email]))[0] || {}).TokenVerificacion;
    ctx.verificar = async (email) => api('GET', '/api/verificar-correo?token=' + await tokenVerif(email));
    const sinConfirmar = (await q(`SELECT correo_verificado, token_verificacion, expiracion_verificacion > NOW() + interval '23 hour' AS vigente FROM usuarios WHERE correo_electronico = 'prov1@prueba.com'`))[0];
    check('La cuenta nueva queda sin confirmar, con un enlace de 24 h', sinConfirmar.CorreoVerificado === 0 && /^[a-f0-9]{64}$/.test(sinConfirmar.TokenVerificacion || '') && sinConfirmar.vigente === 1, JSON.stringify(sinConfirmar));
    r = await ctx.login('prov1@prueba.com', 'Clave123');
    check('Entrar sin confirmar el correo → 403 con verificacionPendiente', r.status === 403 && r.data.verificacionPendiente === true, JSON.stringify(r));
    r = await api('GET', '/api/verificar-correo?token=zzz');
    check('Enlace con formato inválido → 400', r.status === 400 && r.data.ok === false);
    r = await api('GET', '/api/verificar-correo?token=' + 'a'.repeat(64));
    check('Enlace inexistente → 400', r.status === 400);
    r = await api('POST', '/api/reenviar-verificacion', { body: { email: 'no-es-correo' } });
    check('Reenviar a un correo inválido → 400', r.status === 400);
    const respNadie = await api('POST', '/api/reenviar-verificacion', { body: { email: 'nadie@prueba.com' } });
    const tokViejo = await tokenVerif('prov1@prueba.com');
    r = await api('POST', '/api/reenviar-verificacion', { body: { email: 'prov1@prueba.com' } });
    const tokNuevo = await tokenVerif('prov1@prueba.com');
    check('Reenviar responde lo mismo exista o no la cuenta (no revela correos)', respNadie.status === 200 && r.status === 200 && respNadie.data.message === r.data.message, JSON.stringify([respNadie, r]));
    check('…y crea un enlace nuevo', /^[a-f0-9]{64}$/.test(tokNuevo || '') && tokNuevo !== tokViejo);
    r = await api('GET', '/api/verificar-correo?token=' + tokViejo);
    check('…el enlace anterior ya no sirve', r.status === 400);
    const confirmados = [];
    for (const email of ['prov1@prueba.com', 'prov2@prueba.com', 'emp1@prueba.com', 'emp2@prueba.com']) confirmados.push(await ctx.verificar(email));
    check('Las 4 cuentas confirman su correo con su enlace', confirmados.every(x => x.status === 200 && x.data.ok === true), JSON.stringify(confirmados));
    r = await api('GET', '/api/verificar-correo?token=' + tokNuevo);
    check('…y cada enlace sirve una sola vez', r.status === 400);
    const viejas = await q(`SELECT correo_verificado FROM usuarios WHERE correo_electronico IN ('admin@prueba.com', 'antiguo@prueba.com')`);
    check('Las cuentas que ya existían no necesitan confirmar', viejas.length === 2 && viejas.every(v => v.CorreoVerificado === 1));
}
