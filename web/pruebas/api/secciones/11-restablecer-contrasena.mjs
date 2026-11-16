// 10. Restablecer contraseña
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('10. Restablecer contraseña');
    r = await api('POST', '/api/solicitar-recuperacion', { body: { email: 'no-es-correo' } });
    check('Pedir recuperación con correo inválido → 400', r.status === 400);
    r = await api('POST', '/api/solicitar-recuperacion', { body: { email: 'nadie@prueba.com' } });
    check('Pedir recuperación de un correo no registrado responde igual (200)', r.status === 200);
    r = await api('POST', '/api/solicitar-recuperacion', { body: { email: 'emp1@prueba.com' } });
    const filaE1 = (await q(`SELECT token_recuperacion, expiracion_token > NOW() + interval '50 minute' AS vigente FROM usuarios WHERE correo_electronico = 'emp1@prueba.com'`))[0];
    check('Pedir recuperación de un correo registrado guarda un token de 1 hora', r.status === 200 && /^[a-f0-9]{64}$/.test(filaE1.TokenRecuperacion || '') && filaE1.vigente === 1, JSON.stringify(filaE1));
    r = await api('POST', '/api/solicitar-recuperacion', { body: { email: 'emp1@prueba.com' } });
    const filaE1b = (await q(`SELECT token_recuperacion FROM usuarios WHERE correo_electronico = 'emp1@prueba.com'`))[0];
    check('…pedirla otra vez antes de 1 minuto no genera otro token', r.status === 200 && filaE1b.TokenRecuperacion === filaE1.TokenRecuperacion);
    r = await api('GET', '/api/validar-token-recuperacion?token=' + filaE1.TokenRecuperacion);
    check('Validar token vigente muestra el correo oculto', r.status === 200 && r.data.valido === true && r.data.correo === 'e***1@prueba.com', JSON.stringify(r.data));
    r = await api('GET', '/api/validar-token-recuperacion?token=' + 'a'.repeat(64));
    check('Validar token inexistente → 400', r.status === 400 && r.data.valido === false);
    r = await api('GET', '/api/validar-token-recuperacion');
    check('Validar sin token → 400', r.status === 400);
    await q(`UPDATE usuarios SET expiracion_token = NOW() - interval '1 minute' WHERE correo_electronico = 'emp1@prueba.com'`);
    r = await api('GET', '/api/validar-token-recuperacion?token=' + filaE1.TokenRecuperacion);
    check('Validar token vencido → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: filaE1.TokenRecuperacion, nuevaContrasena: 'NuevaClave1' } });
    check('Restablecer con token vencido → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'x', nuevaContrasena: 'a'.repeat(73) } });
    check('Contraseña de más de 72 caracteres → 400', r.status === 400);
    await q(`UPDATE usuarios SET token_recuperacion = 'tok-prueba', expiracion_token = NOW() + interval '1 hour' WHERE usuario_id = $1`, [ctx.p2.id]);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-incorrecto', nuevaContrasena: 'NuevaClave1' } });
    check('Token de recuperación inválido → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-prueba', nuevaContrasena: 'NuevaClave1' } });
    check('Restablecer con token válido', r.status === 200);
    const filaP2 = (await q(`SELECT contrasena_hash, token_recuperacion FROM usuarios WHERE usuario_id = $1`, [ctx.p2.id]))[0];
    check('…la nueva contraseña queda cifrada y el token se borra', /^\$2[aby]\$/.test(filaP2.ContrasenaHash) && filaP2.TokenRecuperacion === null);
    check('…se puede entrar con la nueva contraseña', (await ctx.login('prov2@prueba.com', 'NuevaClave1')).status === 200);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-prueba', nuevaContrasena: 'OtraClave1' } });
    check('…y el mismo enlace no se puede reutilizar', r.status === 400);
}
