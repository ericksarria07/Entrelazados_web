// 23. Correos inválidos y confirmación por el admin
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('23. Correos inválidos y confirmación por el admin');
    const roto = await q(`INSERT INTO usuarios (correo_electronico, contrasena_hash, tipo_rol) VALUES ('roto@gmail', 'clave_rota', 'Emprendedor') RETURNING usuario_id`);
    await q(`INSERT INTO perfiles_usuarios (usuario_id, nombre_razon_social, telefono_whatsapp, departamento_id) VALUES ($1, 'Taller Roto', '88882222', 1) RETURNING perfil_id`, [roto.insertId]);
    r = await ctx.login('roto@gmail', 'clave_rota');
    check('Una cuenta con correo sin ".com" no puede entrar (400)', r.status === 400);
    r = await api('GET', '/api/admin/metricas', { token: ctx.admin.token });
    check('Las métricas del admin cuentan los correos inválidos', r.data.correosInvalidos === 1, JSON.stringify(r.data));
    r = await api('GET', '/api/admin/usuarios?pagina=1&problemas=1', { token: ctx.admin.token });
    check('…y el filtro "con problemas" la muestra marcada como inválida', r.data.datos.some(u => u.UsuarioID === roto.insertId && u.CorreoValido === false), JSON.stringify(r.data.datos));
    r = await api('PUT', `/api/admin/usuarios/${roto.insertId}/correo`, { token: ctx.p3.token, body: { correo: 'roto@gmail.com' } });
    check('Un proveedor no puede corregir correos → 403', r.status === 403);
    r = await api('PUT', `/api/admin/usuarios/${roto.insertId}/correo`, { token: ctx.admin.token, body: { correo: 'roto@gmail' } });
    check('Corregir con otro correo inválido → 400', r.status === 400);
    r = await api('PUT', `/api/admin/usuarios/${roto.insertId}/correo`, { token: ctx.admin.token, body: { correo: 'prov2@prueba.com' } });
    check('Corregir con el correo de otra cuenta → 409', r.status === 409, JSON.stringify(r));
    r = await api('PUT', '/api/admin/usuarios/999999/correo', { token: ctx.admin.token, body: { correo: 'nuevo@prueba.com' } });
    check('Corregir el correo de un usuario que no existe → 404', r.status === 404);
    r = await api('PUT', `/api/admin/usuarios/${roto.insertId}/correo`, { token: ctx.admin.token, body: { correo: 'roto@gmail.com' } });
    check('El admin corrige el correo', r.status === 200, JSON.stringify(r));
    r = await ctx.login('roto@gmail.com', 'clave_rota');
    check('…y la persona ya puede entrar con su contraseña de siempre', r.status === 200, JSON.stringify(r));
    check('…y ya no quedan correos inválidos', (await api('GET', '/api/admin/metricas', { token: ctx.admin.token })).data.correosInvalidos === 0);

    r = await ctx.reg('pendiente@prueba.com', 'Emprendedor', { nombre: 'Taller Pendiente' });
    const pendienteId = (await q(`SELECT usuario_id FROM usuarios WHERE correo_electronico = 'pendiente@prueba.com'`))[0].UsuarioID;
    check('Las métricas cuentan las cuentas sin confirmar', (await api('GET', '/api/admin/metricas', { token: ctx.admin.token })).data.cuentasSinVerificar === 1);
    r = await api('PUT', `/api/admin/usuarios/${pendienteId}/verificar`, { token: ctx.admin.token });
    check('El admin da por confirmado un correo (si no le llega el enlace)', r.status === 200 && (await ctx.login('pendiente@prueba.com', 'Clave123')).status === 200, JSON.stringify(r));

    r = await ctx.reg('olvido@prueba.com', 'Emprendedor', { nombre: 'Taller Olvido' });
    await q(`UPDATE usuarios SET token_recuperacion = 'tok-olvido', expiracion_token = NOW() + interval '1 hour' WHERE correo_electronico = 'olvido@prueba.com'`);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-olvido', nuevaContrasena: 'NuevaClave9' } });
    const filaOlvido = (await q(`SELECT correo_verificado FROM usuarios WHERE correo_electronico = 'olvido@prueba.com'`))[0];
    check('Restablecer la contraseña con el enlace del correo también lo confirma', r.status === 200 && filaOlvido.CorreoVerificado === 1 && (await ctx.login('olvido@prueba.com', 'NuevaClave9')).status === 200);

    r = await ctx.reg('tarde@prueba.com', 'Emprendedor', { nombre: 'Taller Tarde' });
    await q(`UPDATE usuarios SET expiracion_verificacion = NOW() - interval '1 minute' WHERE correo_electronico = 'tarde@prueba.com'`);
    r = await ctx.verificar('tarde@prueba.com');
    check('Un enlace de confirmación vencido → 400', r.status === 400);
    await api('POST', '/api/reenviar-verificacion', { body: { email: 'tarde@prueba.com' } });
    r = await ctx.verificar('tarde@prueba.com');
    check('…se pide uno nuevo y ese sí funciona', r.status === 200 && (await ctx.login('tarde@prueba.com', 'Clave123')).status === 200, JSON.stringify(r));
}
