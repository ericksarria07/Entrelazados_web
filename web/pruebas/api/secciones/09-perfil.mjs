// 8. Perfil
// Portada de backend/pruebas/pruebas_api.js (Express + MySQL) a Next.js + Postgres.
// Las llamadas a la API no cambian: el JSON que esperan es el contrato que usan las páginas.
import { api, check, seccion } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('8. Perfil');
    r = await api('GET', `/api/perfil/${ctx.p1.id}`, { token: ctx.p1.token });
    check('Ver mi propio perfil', r.status === 200 && r.data.CorreoElectronico === 'prov1@prueba.com');
    r = await api('GET', `/api/perfil/${ctx.p1.id}`, { token: ctx.e1.token });
    check('Ver el perfil (correo, teléfono) de otro usuario → 403', r.status === 403);
    r = await api('GET', `/api/perfil/${ctx.p1.id}`, { token: ctx.admin.token });
    check('Admin puede ver cualquier perfil', r.status === 200);
    r = await api('GET', `/api/perfil/${ctx.p1.id}`);
    check('Perfil sin sesión → 401', r.status === 401);
    await editar(ctx);
}

// Editar mi perfil (PUT /api/perfil/[id]). Al final se dejan los datos como estaban,
// porque las secciones siguientes usan estas cuentas.
export async function editar(ctx) {
    let r;
    const original = (await api('GET', `/api/perfil/${ctx.p1.id}`, { token: ctx.p1.token })).data;
    const originalE = (await api('GET', `/api/perfil/${ctx.e1.id}`, { token: ctx.e1.token })).data;
    const base = { nombre: 'Curtiembre Editada', telefono: '+505 8888-1234', departamento: 'leon' };

    r = await api('PUT', `/api/perfil/${ctx.p1.id}`, {
        token: ctx.p1.token,
        body: { ...base, numeroRuc: 'J0310000000001', nombreComercial: 'Cueros León', tipoMateriaPrimaPrincipal: 'Cuero vacuno', descripcionEmpresa: 'Curtido al vegetal.' },
    });
    check('Editar mi perfil (proveedor) → 200 con el perfil nuevo', r.status === 200 && r.data.NombreRazonSocial === 'Curtiembre Editada', JSON.stringify(r.data));
    check('…el departamento se guarda con su nombre oficial ("leon" → "León")', r.data?.NombreDepartamento === 'León', r.data?.NombreDepartamento);
    check('…y los datos del proveedor también', r.data?.NumeroRUC === 'J0310000000001' && r.data?.NombreComercial === 'Cueros León' && r.data?.DescripcionEmpresa === 'Curtido al vegetal.');
    r = await api('GET', `/api/perfil/${ctx.p1.id}`, { token: ctx.p1.token });
    check('…el GET lo refleja', r.data?.TelefonoWhatsApp === '+505 8888-1234' && r.data?.TipoMateriaPrimaPrincipal === 'Cuero vacuno');
    r = await api('PUT', `/api/perfil/${ctx.p1.id}`, { token: ctx.p1.token, body: { ...base, numeroRuc: '', nombreComercial: '' } });
    check('Un dato opcional vacío se borra (NULL)', r.status === 200 && r.data.NumeroRUC === null && r.data.NombreComercial === null, JSON.stringify(r.data));

    r = await api('PUT', `/api/perfil/${ctx.e1.id}`, { token: ctx.e1.token, body: { ...base, nombre: 'Zapatería Editada', nombreMarca: 'Pasos Firmes', especialidadCalzado: 'Botas', capacidadProduccionMensual: '120' } });
    check('Editar mi perfil (emprendedor): marca, especialidad y capacidad', r.status === 200 && r.data.NombreMarca === 'Pasos Firmes' && r.data.CapacidadProduccionMensual === 120, JSON.stringify(r.data));

    r = await api('PUT', `/api/perfil/${ctx.p1.id}`, { token: ctx.e1.token, body: base });
    check('Editar el perfil de otro → 403', r.status === 403);
    r = await api('PUT', `/api/perfil/${ctx.p1.id}`, { token: ctx.admin.token, body: base });
    check('…tampoco el admin edita el perfil de otro → 403', r.status === 403);
    r = await api('PUT', `/api/perfil/${ctx.p1.id}`, { body: base });
    check('Editar sin sesión → 401', r.status === 401);

    for (const [nombre, cambio] of [
        ['nombre vacío', { nombre: ' ' }],
        ['teléfono con letras', { telefono: 'llámame' }],
        ['teléfono de más de 20 caracteres', { telefono: '1'.repeat(21) }],
        ['departamento que no existe', { departamento: 'Narnia' }],
        ['departamento vacío', { departamento: '' }],
    ]) {
        r = await api('PUT', `/api/perfil/${ctx.p1.id}`, { token: ctx.p1.token, body: { ...base, ...cambio } });
        check(`Editar con ${nombre} → 400`, r.status === 400, `${r.status} ${JSON.stringify(r.data)}`);
    }
    r = await api('PUT', `/api/perfil/${ctx.p1.id}`, { token: ctx.p1.token, body: { ...base, descripcionEmpresa: 'x'.repeat(2001) } });
    check('Descripción de más de 2000 caracteres → 400', r.status === 400);
    r = await api('PUT', `/api/perfil/${ctx.e1.id}`, { token: ctx.e1.token, body: { ...base, capacidadProduccionMensual: -5 } });
    check('Capacidad mensual negativa → 400', r.status === 400);
    r = await api('PUT', `/api/perfil/${ctx.e1.id}`, { token: ctx.e1.token, body: { ...base, capacidadProduccionMensual: 2.5 } });
    check('Capacidad mensual con decimales → 400', r.status === 400);

    // Se dejan como estaban
    const restaurar = (o) => ({
        nombre: o.NombreRazonSocial, telefono: o.TelefonoWhatsApp || '88880000', departamento: o.NombreDepartamento,
        numeroRuc: o.NumeroRUC, nombreComercial: o.NombreComercial, tipoMateriaPrimaPrincipal: o.TipoMateriaPrimaPrincipal,
        descripcionEmpresa: o.DescripcionEmpresa, nombreMarca: o.NombreMarca, especialidadCalzado: o.EspecialidadCalzado,
        capacidadProduccionMensual: o.CapacidadProduccionMensual,
    });
    const r1 = await api('PUT', `/api/perfil/${ctx.p1.id}`, { token: ctx.p1.token, body: restaurar(original) });
    const r2 = await api('PUT', `/api/perfil/${ctx.e1.id}`, { token: ctx.e1.token, body: restaurar(originalE) });
    check('Los perfiles quedan como estaban', r1.status === 200 && r1.data.NombreRazonSocial === original.NombreRazonSocial && r2.status === 200 && r2.data.NombreRazonSocial === originalE.NombreRazonSocial, `${r1.status} ${r2.status} ${JSON.stringify(r1.data)}`);
}
