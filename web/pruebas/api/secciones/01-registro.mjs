// 1. Registro
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion, q } from '../contexto.mjs';

export default async function correr(ctx) {
    seccion('1. Registro');
    ctx.reg = (email, rol, extra = {}) => api('POST', '/registro', { body: { nombre: extra.nombre || email.split('@')[0], email, telefono: '88887777', rol, deptoId: 'Managua', password: 'Clave123', ...extra } });
    let r = await ctx.reg('prov1@prueba.com', 'Proveedor', { nombre: 'Curtiembre Uno' });
    check('Registrar proveedor 1 (avisa que falta confirmar el correo)', r.status === 200 && r.data.verificacionPendiente === true && /confirmar tu cuenta/.test(r.data.message), JSON.stringify(r));
    r = await ctx.reg('prov2@prueba.com', 'Proveedor', { nombre: 'Curtiembre Dos' });
    check('Registrar proveedor 2', r.status === 200, JSON.stringify(r));
    r = await ctx.reg('emp1@prueba.com', 'Emprendedor', { nombre: 'Zapatería Uno' });
    check('Registrar emprendedor 1', r.status === 200, JSON.stringify(r));
    r = await ctx.reg('emp2@prueba.com', 'Emprendedor', { nombre: '<img src=x onerror="window.__xss=1">' });
    check('Registrar emprendedor 2 (nombre con HTML malicioso)', r.status === 200, JSON.stringify(r));
    r = await ctx.reg('hacker@prueba.com', 'Administrador');
    check('Registrarse como Administrador → rechazado (400)', r.status === 400, JSON.stringify(r));
    r = await ctx.reg('prov1@prueba.com', 'Proveedor');
    check('Correo duplicado → rechazado', r.status >= 400, JSON.stringify(r));
    r = await ctx.reg('corta@prueba.com', 'Proveedor', { password: '123' });
    check('Contraseña de menos de 6 caracteres → 400', r.status === 400);
    const filaP1 = (await q(`SELECT contrasena_hash FROM usuarios WHERE correo_electronico = $1`, ['prov1@prueba.com']))[0];
    check('La contraseña se guarda cifrada con bcrypt', /^\$2[aby]\$/.test(filaP1.ContrasenaHash), filaP1.ContrasenaHash);
}
