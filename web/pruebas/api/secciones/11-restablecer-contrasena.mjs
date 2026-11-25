// 10. Restablecer contraseña
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, enlaceDelLog, seccion, q } from '../contexto.mjs';

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
    // El token del enlace sale del log del servidor: la base guarda solo su SHA-256
    const tokE1 = enlaceDelLog('recuperacion', 'emp1@prueba.com');
    check('…la base guarda el hash del token, no el token del enlace', /^[a-f0-9]{64}$/.test(tokE1 || '') && tokE1 !== filaE1.TokenRecuperacion, String(tokE1));
    r = await api('GET', '/api/validar-token-recuperacion?token=' + filaE1.TokenRecuperacion);
    check('…y el hash guardado no sirve como enlace', r.status === 400);
    r = await api('GET', '/api/validar-token-recuperacion?token=' + tokE1);
    check('Validar token vigente muestra el correo oculto', r.status === 200 && r.data.valido === true && r.data.correo === 'e***1@prueba.com', JSON.stringify(r.data));
    r = await api('GET', '/api/validar-token-recuperacion?token=' + 'a'.repeat(64));
    check('Validar token inexistente → 400', r.status === 400 && r.data.valido === false);
    r = await api('GET', '/api/validar-token-recuperacion');
    check('Validar sin token → 400', r.status === 400);
    await q(`UPDATE usuarios SET expiracion_token = NOW() - interval '1 minute' WHERE correo_electronico = 'emp1@prueba.com'`);
    r = await api('GET', '/api/validar-token-recuperacion?token=' + tokE1);
    check('Validar token vencido → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: tokE1, nuevaContrasena: 'NuevaClave1' } });
    check('Restablecer con token vencido → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'x', nuevaContrasena: 'a'.repeat(73) } });
    check('Contraseña de más de 72 caracteres → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'x', nuevaContrasena: 'Corta12' } });
    check('Contraseña nueva de menos de 8 caracteres → 400', r.status === 400 && /al menos 8/.test(r.data.message), JSON.stringify(r.data));
    await q(`UPDATE usuarios SET token_recuperacion = encode(sha256('tok-prueba'::bytea), 'hex'), expiracion_token = NOW() + interval '1 hour' WHERE usuario_id = $1`, [ctx.p2.id]);
    const tokenViejoP2 = ctx.p2.token;
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-incorrecto', nuevaContrasena: 'NuevaClave1' } });
    check('Token de recuperación inválido → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-prueba', nuevaContrasena: 'NuevaClave1' } });
    check('Restablecer con token válido', r.status === 200);
    const filaP2 = (await q(`SELECT contrasena_hash, token_recuperacion FROM usuarios WHERE usuario_id = $1`, [ctx.p2.id]))[0];
    check('…la nueva contraseña queda cifrada y el token se borra', /^\$2[aby]\$/.test(filaP2.ContrasenaHash) && filaP2.TokenRecuperacion === null);
    r = await api('GET', '/api/sesion', { token: tokenViejoP2 });
    check('…y la sesión que estaba abierta se cierra (aunque alguien haya copiado el token)', r.status === 401, String(r.status));
    r = await ctx.login('prov2@prueba.com', 'NuevaClave1');
    check('…se puede entrar con la nueva contraseña', r.status === 200);
    ctx.p2 = r.data; // las secciones siguientes usan la sesión nueva
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-prueba', nuevaContrasena: 'OtraClave1' } });
    check('…y el mismo enlace no se puede reutilizar', r.status === 400);
}
