// Pruebas de integración de la API de EntreLazados contra la BD local entrelazados_pruebas
const [, , backend, dbPass] = process.argv;
const mysql = require(backend + '/node_modules/mysql2/promise');
const jwt = require(backend + '/node_modules/jsonwebtoken');
const B = 'http://localhost:3055';

let ok = 0, fallos = 0;
const resultados = [];
function check(nombre, condicion, detalle = '') {
    if (condicion) { ok++; resultados.push(`  ✅ ${nombre}`); }
    else { fallos++; resultados.push(`  ❌ ${nombre} ${detalle}`); }
}
function seccion(t) { resultados.push(`\n${t}`); }

async function api(metodo, ruta, { token, body, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = 'Bearer ' + token;
    const r = await fetch(B + ruta, { method: metodo, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await r.json(); } catch (e) { }
    return { status: r.status, data };
}

(async () => {
    const db = await mysql.createConnection({ host: process.env.PRUEBAS_DB_HOST || 'localhost', user: 'entrelazados_pruebas', password: dbPass, database: 'entrelazados_pruebas' });
    const q = async (sql, p = []) => (await db.query(sql, p))[0];

    // ---------------------------------------------------------------- REGISTRO
    seccion('1. Registro');
    const reg = (email, rol, extra = {}) => api('POST', '/registro', { body: { nombre: extra.nombre || email.split('@')[0], email, telefono: '88887777', rol, deptoId: 'Managua', password: 'Clave123', ...extra } });
    let r = await reg('prov1@prueba.com', 'Proveedor', { nombre: 'Curtiembre Uno' });
    check('Registrar proveedor 1 (avisa que falta confirmar el correo)', r.status === 200 && r.data.verificacionPendiente === true && /confirmar tu cuenta/.test(r.data.message), JSON.stringify(r));
    r = await reg('prov2@prueba.com', 'Proveedor', { nombre: 'Curtiembre Dos' });
    check('Registrar proveedor 2', r.status === 200, JSON.stringify(r));
    r = await reg('emp1@prueba.com', 'Emprendedor', { nombre: 'Zapatería Uno' });
    check('Registrar emprendedor 1', r.status === 200, JSON.stringify(r));
    r = await reg('emp2@prueba.com', 'Emprendedor', { nombre: '<img src=x onerror="window.__xss=1">' });
    check('Registrar emprendedor 2 (nombre con HTML malicioso)', r.status === 200, JSON.stringify(r));
    r = await reg('hacker@prueba.com', 'Administrador');
    check('Registrarse como Administrador → rechazado (400)', r.status === 400, JSON.stringify(r));
    r = await reg('prov1@prueba.com', 'Proveedor');
    check('Correo duplicado → rechazado', r.status >= 400, JSON.stringify(r));
    r = await reg('corta@prueba.com', 'Proveedor', { password: '123' });
    check('Contraseña de menos de 6 caracteres → 400', r.status === 400);
    const filaP1 = (await q('SELECT ContrasenaHash FROM Usuarios WHERE CorreoElectronico = ?', ['prov1@prueba.com']))[0];
    check('La contraseña se guarda cifrada con bcrypt', /^\$2[aby]\$/.test(filaP1.ContrasenaHash), filaP1.ContrasenaHash);

    // ---------------------------------------------------------------- CONFIRMAR EL CORREO
    seccion('1b. Confirmar el correo (VERIFICAR_CORREO=1)');
    const login = async (email, password) => api('POST', '/api/login', { body: { email, password } });
    const tokenVerif = async (email) => ((await q('SELECT TokenVerificacion FROM Usuarios WHERE CorreoElectronico = ?', [email]))[0] || {}).TokenVerificacion;
    const verificar = async (email) => api('GET', '/api/verificar-correo?token=' + await tokenVerif(email));
    const sinConfirmar = (await q("SELECT CorreoVerificado, TokenVerificacion, ExpiracionVerificacion > NOW() + INTERVAL 23 HOUR AS vigente FROM Usuarios WHERE CorreoElectronico = 'prov1@prueba.com'"))[0];
    check('La cuenta nueva queda sin confirmar, con un enlace de 24 h', sinConfirmar.CorreoVerificado === 0 && /^[a-f0-9]{64}$/.test(sinConfirmar.TokenVerificacion || '') && sinConfirmar.vigente === 1, JSON.stringify(sinConfirmar));
    r = await login('prov1@prueba.com', 'Clave123');
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
    for (const email of ['prov1@prueba.com', 'prov2@prueba.com', 'emp1@prueba.com', 'emp2@prueba.com']) confirmados.push(await verificar(email));
    check('Las 4 cuentas confirman su correo con su enlace', confirmados.every(x => x.status === 200 && x.data.ok === true), JSON.stringify(confirmados));
    r = await api('GET', '/api/verificar-correo?token=' + tokNuevo);
    check('…y cada enlace sirve una sola vez', r.status === 400);
    const viejas = await q("SELECT CorreoVerificado FROM Usuarios WHERE CorreoElectronico IN ('admin@prueba.com', 'antiguo@prueba.com')");
    check('Las cuentas que ya existían no necesitan confirmar', viejas.length === 2 && viejas.every(v => v.CorreoVerificado === 1));

    // ---------------------------------------------------------------- LOGIN
    seccion('2. Inicio de sesión');
    const sesiones = {};
    for (const [k, email, pass] of [['p1', 'prov1@prueba.com', 'Clave123'], ['p2', 'prov2@prueba.com', 'Clave123'], ['e1', 'emp1@prueba.com', 'Clave123'], ['e2', 'emp2@prueba.com', 'Clave123'], ['admin', 'admin@prueba.com', 'Admin123!']]) {
        r = await login(email, pass);
        check(`Login ${email}`, r.status === 200 && r.data.token, JSON.stringify(r));
        sesiones[k] = r.data;
    }
    r = await login('prov1@prueba.com', 'Incorrecta1');
    check('Contraseña incorrecta → 401', r.status === 401);
    r = await login('noexiste@prueba.com', 'Clave123');
    check('Correo inexistente → 401 (mismo mensaje, no revela si existe)', r.status === 401 && r.data.message === 'Correo o contraseña incorrectos.');
    r = await login('antiguo@prueba.com', 'clave_vieja');
    check('Usuario antiguo (texto plano) puede entrar', r.status === 200, JSON.stringify(r));
    await new Promise(res => setTimeout(res, 300));
    const filaAnt = (await q('SELECT ContrasenaHash FROM Usuarios WHERE CorreoElectronico = ?', ['antiguo@prueba.com']))[0];
    check('…y su contraseña se migró automáticamente a bcrypt', /^\$2[aby]\$/.test(filaAnt.ContrasenaHash), filaAnt.ContrasenaHash);
    r = await login('antiguo@prueba.com', 'clave_vieja');
    check('…y puede volver a entrar con la misma contraseña', r.status === 200);
    const { p1, p2, e1, e2, admin } = sesiones;

    // ---------------------------------------------------------------- TOKENS
    seccion('3. Tokens');
    const falso = jwt.sign({ id: admin.id, rol: 'Administrador' }, 'secreto-inventado');
    r = await api('GET', '/api/admin/metricas', { token: falso });
    check('Token firmado con otro secreto → 401', r.status === 401);
    r = await api('GET', '/api/admin/metricas', { headers: { 'x-user-id': String(admin.id) } });
    check('Truco viejo x-user-id del admin → 401', r.status === 401);
    const payloadVencido = JSON.parse(Buffer.from(p1.token.split('.')[1], 'base64url'));
    check('El token expira (tiene campo exp de 8 h)', payloadVencido.exp - payloadVencido.iat === 8 * 3600);

    // ---------------------------------------------------------------- OFERTAS
    seccion('4. Ofertas');
    const oferta = { titulo: 'Cuero vacuno curtido', precio: 450, unidad: 'pie²', distancia: 12, categoriaId: 1, fotos: [] };
    r = await api('POST', '/api/ofertas', { body: oferta });
    check('Publicar sin sesión → 401', r.status === 401);
    r = await api('POST', '/api/ofertas', { token: e1.token, body: oferta });
    check('Emprendedor intenta publicar → 403', r.status === 403);
    r = await api('POST', '/api/ofertas', { token: p1.token, body: { ...oferta, proveedorId: p2.id } });
    check('Proveedor 1 publica (enviando proveedorId falso del proveedor 2)', r.status === 200, JSON.stringify(r));
    r = await api('POST', '/api/ofertas', { token: p2.token, body: { ...oferta, titulo: 'Suela de hule', precio: 120 } });
    check('Proveedor 2 publica', r.status === 200);
    r = await api('POST', '/api/ofertas', { token: p1.token, body: { ...oferta, precio: -5 } });
    check('Precio negativo → 400', r.status === 400);
    const ofertas = (await api('GET', '/api/ofertas')).data;
    const ofP1 = ofertas.find(o => o.TituloMaterial === 'Cuero vacuno curtido');
    const ofP2 = ofertas.find(o => o.TituloMaterial === 'Suela de hule');
    check('La oferta quedó a nombre del proveedor 1 (se ignoró el ID falso)', ofP1 && ofP1.ProveedorID === p1.id, JSON.stringify(ofP1));
    check('/api/ofertas incluye el CategoriaID (para filtrar por categoría)', ofP1 && ofP1.CategoriaID === 1 && ofP1.NombreCategoria === 'Cuero Bovino / Vacuno', JSON.stringify(ofP1));
    await q("UPDATE Ofertas SET Fotos = '{no es json' WHERE OfertaID = ?", [ofP2.OfertaID]);
    r = await api('GET', '/api/ofertas');
    check('Fotos con JSON dañado no tumban /api/ofertas', r.status === 200 && r.data.length === 2);

    // ---------------------------------------------------------------- SUBASTAS Y PUJAS
    seccion('5. Subastas y pujas');
    const subastas = (await api('GET', '/api/subastas')).data;
    check('Cada oferta creó su subasta', subastas.length === 2);
    const subP1 = subastas.find(s => s.ProveedorID === p1.id);
    check('…ligada a su publicación y a su categoría (OfertaID, CategoriaID)', subP1 && subP1.OfertaID === ofP1.OfertaID && subP1.CategoriaID === 1 && subP1.NombreCategoria === 'Cuero Bovino / Vacuno', JSON.stringify(subP1));
    check('…con el número de pujas y sin foto (la publicación no tiene)', subP1 && subP1.TotalPujas === 0 && subP1.Foto === null, JSON.stringify(subP1));
    r = await api('POST', '/api/pujas', { body: { subastaId: subP1.SubastaID, montoPuja: 500 } });
    check('Pujar sin sesión → 401', r.status === 401);
    r = await api('POST', '/api/pujas', { token: p2.token, body: { subastaId: subP1.SubastaID, montoPuja: 500 } });
    check('Proveedor intenta pujar → 403', r.status === 403);
    r = await api('POST', '/api/pujas', { token: e1.token, body: { subastaId: subP1.SubastaID, montoPuja: 300 } });
    check('Puja menor al precio actual → 409', r.status === 409, JSON.stringify(r));
    r = await api('POST', '/api/pujas', { token: e1.token, body: { subastaId: subP1.SubastaID, montoPuja: 500, emprendedorId: e2.id } });
    check('Puja válida de 500 (con emprendedorId falso)', r.status === 200, JSON.stringify(r));
    const puja = (await q('SELECT EmprendedorID FROM Pujas WHERE SubastaID = ?', [subP1.SubastaID]))[0];
    check('La puja quedó a nombre del emprendedor 1', puja.EmprendedorID === e1.id);
    r = await api('POST', '/api/pujas', { token: e2.token, body: { subastaId: subP1.SubastaID, montoPuja: 500 } });
    check('Puja igual al precio actual → 409', r.status === 409);
    const montos = [510, 530, 590, 520, 560, 580, 540, 570];
    const simultaneas = await Promise.all(montos.map((m, i) => api('POST', '/api/pujas', { token: (i % 2 ? e1 : e2).token, body: { subastaId: subP1.SubastaID, montoPuja: m } })));
    const precioFinal = Number((await q('SELECT PrecioActual FROM Subastas WHERE SubastaID = ?', [subP1.SubastaID]))[0].PrecioActual);
    check(`8 pujas simultáneas: el precio final es la mayor (590)`, precioFinal === 590, `precio=${precioFinal}`);
    const aceptadas = simultaneas.filter(x => x.status === 200).length;
    const filasPujas = (await q('SELECT COUNT(*) n FROM Pujas WHERE SubastaID = ?', [subP1.SubastaID]))[0].n;
    check('Historial de pujas coincide con las aceptadas', filasPujas === aceptadas + 1, `aceptadas=${aceptadas} filas=${filasPujas}`);
    await q("UPDATE Subastas SET FechaFin = NOW() - INTERVAL 1 HOUR WHERE SubastaID = ?", [subP1.SubastaID]);
    r = await api('POST', '/api/pujas', { token: e1.token, body: { subastaId: subP1.SubastaID, montoPuja: 9999 } });
    check('Pujar en subasta vencida → 409 "ya finalizó"', r.status === 409 && /finaliz/.test(r.data.message), JSON.stringify(r));
    r = await api('POST', '/api/pujas', { token: e1.token, body: { subastaId: 999999, montoPuja: 10 } });
    check('Subasta inexistente → 404', r.status === 404);

    // ---------------------------------------------------------------- BORRAR OFERTAS
    seccion('6. Borrar ofertas');
    r = await api('DELETE', `/api/ofertas/${ofP1.OfertaID}`, { token: p2.token, body: { proveedorId: p1.id } });
    check('Proveedor 2 intenta borrar oferta del proveedor 1 (con ID falso) → 403', r.status === 403);
    r = await api('DELETE', `/api/ofertas/${ofP1.OfertaID}`, { token: p1.token });
    check('Proveedor 1 borra su propia oferta', r.status === 200);
    let filaSub = (await q('SELECT Estado, OfertaID FROM Subastas WHERE SubastaID = ?', [subP1.SubastaID]))[0];
    check('…su subasta YA VENCIDA con pujas no se cancela (el cierre le dará ganador) y queda sin OfertaID', filaSub.Estado === 'Activa' && filaSub.OfertaID === null, JSON.stringify(filaSub));
    const subOfP2 = (await q('SELECT SubastaID FROM Subastas WHERE OfertaID = ?', [ofP2.OfertaID]))[0];
    r = await api('DELETE', `/api/ofertas/${ofP2.OfertaID}`, { token: admin.token });
    check('Admin puede borrar cualquier oferta', r.status === 200);
    filaSub = (await q('SELECT Estado FROM Subastas WHERE SubastaID = ?', [subOfP2.SubastaID]))[0];
    check('…y su subasta abierta queda "Cancelada" (ya no sigue activa sin publicación)', filaSub.Estado === 'Cancelada' && /también se canceló/.test(r.data.message), JSON.stringify([filaSub, r.data]));
    check('…y desaparece de /api/subastas', !(await api('GET', '/api/subastas')).data.some(x => x.SubastaID === subOfP2.SubastaID));
    r = await api('POST', '/api/pujas', { token: e1.token, body: { subastaId: subOfP2.SubastaID, montoPuja: 9999 } });
    check('…pujar en ella → 409 "fue cancelada"', r.status === 409 && /cancelada/.test(r.data.message), JSON.stringify(r));

    // ---------------------------------------------------------------- CHAT
    seccion('7. Chat');
    r = await api('GET', '/api/chat/contactos');
    check('Contactos sin sesión → 401', r.status === 401);
    r = await api('GET', '/api/chat/contactos', { token: e1.token });
    check('Contactos no incluyen al propio usuario', r.status === 200 && !r.data.some(c => c.UsuarioID === e1.id) && r.data.length >= 4);
    r = await api('POST', '/api/chat/enviar', { token: e1.token, body: { remitenteId: p2.id, destinatarioId: p1.id, texto: 'Hola, ¿tiene cuero en stock?' } });
    check('Emprendedor 1 escribe a proveedor 1 (con remitenteId falso)', r.status === 200);
    const msg = (await q('SELECT RemitenteID FROM MensajesChat ORDER BY MensajeID DESC LIMIT 1'))[0];
    check('El mensaje quedó a nombre del emprendedor 1', msg.RemitenteID === e1.id);
    await api('POST', '/api/chat/enviar', { token: e2.token, body: { destinatarioId: p1.id, texto: '<img src=x onerror="window.__xss=1">' } });
    r = await api('GET', `/api/chat/mensajes?remitenteId=${e1.id}&destinatarioId=${p1.id}`, { token: p2.token });
    check('Proveedor 2 NO puede leer la conversación emprendedor 1 ↔ proveedor 1', r.status === 200 && r.data.length === 0, JSON.stringify(r.data));
    r = await api('GET', `/api/chat/mensajes?destinatarioId=${e1.id}`, { token: p1.token });
    check('Proveedor 1 sí ve su conversación con emprendedor 1', r.status === 200 && r.data.length === 1);
    r = await api('POST', '/api/chat/enviar', { token: e1.token, body: { destinatarioId: e1.id, texto: 'yo' } });
    check('Enviarse mensajes a sí mismo → 400', r.status === 400);
    r = await api('POST', '/api/chat/enviar', { token: e1.token, body: { destinatarioId: p1.id, texto: 'x'.repeat(2001) } });
    check('Mensaje de más de 2000 caracteres → 400', r.status === 400);

    // ---------------------------------------------------------------- PERFIL
    seccion('8. Perfil');
    r = await api('GET', `/api/perfil/${p1.id}`, { token: p1.token });
    check('Ver mi propio perfil', r.status === 200 && r.data.CorreoElectronico === 'prov1@prueba.com');
    r = await api('GET', `/api/perfil/${p1.id}`, { token: e1.token });
    check('Ver el perfil (correo, teléfono) de otro usuario → 403', r.status === 403);
    r = await api('GET', `/api/perfil/${p1.id}`, { token: admin.token });
    check('Admin puede ver cualquier perfil', r.status === 200);
    r = await api('GET', `/api/perfil/${p1.id}`);
    check('Perfil sin sesión → 401', r.status === 401);

    // ---------------------------------------------------------------- ADMIN
    seccion('9. Panel de administrador');
    r = await api('GET', '/api/admin/metricas', { token: p1.token });
    check('Proveedor entra a métricas de admin → 403', r.status === 403);
    r = await api('GET', '/api/admin/metricas', { token: admin.token });
    check('Admin ve métricas', r.status === 200 && r.data.totalUsuarios === 6, JSON.stringify(r.data));
    r = await api('GET', '/api/admin/usuarios', { token: admin.token });
    check('Admin lista usuarios (corregido FechaCreacion → FechaRegistro)', r.status === 200 && r.data.length === 6 && r.data[0].FechaCreacion, JSON.stringify(r).slice(0, 200));
    r = await api('POST', '/api/admin/categorias', { token: admin.token, body: { nombreCategoria: 'Cordones y Agujetas', descripcion: 'Cordones de algodón y cuero' } });
    check('Admin crea categoría con descripción', r.status === 200, JSON.stringify(r));
    r = await api('PUT', `/api/admin/usuarios/${e1.id}/estado`, { token: admin.token, body: { nuevoEstado: 'Suspendido' } });
    check('Admin suspende al emprendedor 1', r.status === 200);
    r = await api('GET', '/api/chat/contactos', { token: e1.token });
    check('…su token deja de funcionar al instante (403)', r.status === 403, JSON.stringify(r));
    r = await login('emp1@prueba.com', 'Clave123');
    check('…y no puede iniciar sesión (403)', r.status === 403);
    await api('PUT', `/api/admin/usuarios/${e1.id}/estado`, { token: admin.token, body: { nuevoEstado: 'Activo' } });
    r = await api('GET', '/api/chat/contactos', { token: e1.token });
    check('Al reactivarlo vuelve a funcionar', r.status === 200);
    r = await api('PUT', `/api/admin/usuarios/${e1.id}/estado`, { token: admin.token, body: { nuevoEstado: 'Hackeado' } });
    check('Estado inválido → 400', r.status === 400);
    await q('UPDATE Usuarios SET TipoRol = ? WHERE UsuarioID = ?', ['Proveedor', admin.id]);
    r = await api('GET', '/api/admin/metricas', { token: admin.token });
    check('Si le quitan el rol de admin, su token ya no da acceso (403)', r.status === 403);
    await q('UPDATE Usuarios SET TipoRol = ? WHERE UsuarioID = ?', ['Administrador', admin.id]);

    // ---------------------------------------------------------------- RESTABLECER CONTRASEÑA
    seccion('10. Restablecer contraseña');
    r = await api('POST', '/api/solicitar-recuperacion', { body: { email: 'no-es-correo' } });
    check('Pedir recuperación con correo inválido → 400', r.status === 400);
    r = await api('POST', '/api/solicitar-recuperacion', { body: { email: 'nadie@prueba.com' } });
    check('Pedir recuperación de un correo no registrado responde igual (200)', r.status === 200);
    r = await api('POST', '/api/solicitar-recuperacion', { body: { email: 'emp1@prueba.com' } });
    const filaE1 = (await q("SELECT TokenRecuperacion, ExpiracionToken > NOW() + INTERVAL 50 MINUTE AS vigente FROM Usuarios WHERE CorreoElectronico = 'emp1@prueba.com'"))[0];
    check('Pedir recuperación de un correo registrado guarda un token de 1 hora', r.status === 200 && /^[a-f0-9]{64}$/.test(filaE1.TokenRecuperacion || '') && filaE1.vigente === 1, JSON.stringify(filaE1));
    r = await api('POST', '/api/solicitar-recuperacion', { body: { email: 'emp1@prueba.com' } });
    const filaE1b = (await q("SELECT TokenRecuperacion FROM Usuarios WHERE CorreoElectronico = 'emp1@prueba.com'"))[0];
    check('…pedirla otra vez antes de 1 minuto no genera otro token', r.status === 200 && filaE1b.TokenRecuperacion === filaE1.TokenRecuperacion);
    r = await api('GET', '/api/validar-token-recuperacion?token=' + filaE1.TokenRecuperacion);
    check('Validar token vigente muestra el correo oculto', r.status === 200 && r.data.valido === true && r.data.correo === 'e***1@prueba.com', JSON.stringify(r.data));
    r = await api('GET', '/api/validar-token-recuperacion?token=' + 'a'.repeat(64));
    check('Validar token inexistente → 400', r.status === 400 && r.data.valido === false);
    r = await api('GET', '/api/validar-token-recuperacion');
    check('Validar sin token → 400', r.status === 400);
    await q("UPDATE Usuarios SET ExpiracionToken = NOW() - INTERVAL 1 MINUTE WHERE CorreoElectronico = 'emp1@prueba.com'");
    r = await api('GET', '/api/validar-token-recuperacion?token=' + filaE1.TokenRecuperacion);
    check('Validar token vencido → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: filaE1.TokenRecuperacion, nuevaContrasena: 'NuevaClave1' } });
    check('Restablecer con token vencido → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'x', nuevaContrasena: 'a'.repeat(73) } });
    check('Contraseña de más de 72 caracteres → 400', r.status === 400);
    await q("UPDATE Usuarios SET TokenRecuperacion = 'tok-prueba', ExpiracionToken = NOW() + INTERVAL 1 HOUR WHERE UsuarioID = ?", [p2.id]);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-incorrecto', nuevaContrasena: 'NuevaClave1' } });
    check('Token de recuperación inválido → 400', r.status === 400);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-prueba', nuevaContrasena: 'NuevaClave1' } });
    check('Restablecer con token válido', r.status === 200);
    const filaP2 = (await q('SELECT ContrasenaHash, TokenRecuperacion FROM Usuarios WHERE UsuarioID = ?', [p2.id]))[0];
    check('…la nueva contraseña queda cifrada y el token se borra', /^\$2[aby]\$/.test(filaP2.ContrasenaHash) && filaP2.TokenRecuperacion === null);
    check('…se puede entrar con la nueva contraseña', (await login('prov2@prueba.com', 'NuevaClave1')).status === 200);
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-prueba', nuevaContrasena: 'OtraClave1' } });
    check('…y el mismo enlace no se puede reutilizar', r.status === 400);

    // ---------------------------------------------------------------- PÚBLICAS
    seccion('11. Rutas públicas y errores');
    r = await api('GET', '/api/estadisticas');
    check('Estadísticas públicas', r.status === 200 && r.data.proveedores === 2 && r.data.emprendedores === 3, JSON.stringify(r.data));
    r = await api('POST', '/api/chat/ia', { body: { mensajeUsuario: 'hola' } });
    check('Kan sin sesión → 401 (nadie de fuera gasta la cuota de Gemini)', r.status === 401);
    r = await api('POST', '/api/chat/ia', { token: e1.token, body: { mensajeUsuario: 'hola' } });
    check('Kan responde con sesión', r.status === 200 && /Kan/.test(r.data.respuesta), JSON.stringify(r));
    r = await api('POST', '/api/chat/ia', { token: admin.token, body: { mensajeUsuario: 'quiero ver las métricas', rolUsuario: 'emprendedor' } });
    check('Kan usa el rol de la sesión (admin), no el que manda el navegador', r.status === 200 && /Administración/.test(r.data.respuesta), JSON.stringify(r));

    // ---------------------------------------------------------------- FOTOS
    seccion('13. Fotos de las ofertas');
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
    const campos = { titulo: 'Hebillas de bronce', precio: 35, unidad: 'docena', distancia: 4, categoriaId: 6 };
    async function publicarConFotos(token, archivos, extra = {}) {
        const fd = new FormData();
        for (const [k, v] of Object.entries({ ...campos, ...extra })) fd.append(k, String(v));
        for (const a of archivos) fd.append('fotos', new Blob([a.datos], { type: a.tipo }), a.nombre);
        const resp = await fetch(B + '/api/ofertas', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd });
        let data = null;
        try { data = await resp.json(); } catch (e) { }
        return { status: resp.status, data };
    }
    const contarOfertas = async () => (await q('SELECT COUNT(*) n FROM Ofertas'))[0].n;
    const ofertasAntes = await contarOfertas();

    r = await publicarConFotos(null, [{ datos: PNG, tipo: 'image/png', nombre: 'a.png' }]);
    check('Subir fotos sin sesión → 401', r.status === 401);
    r = await publicarConFotos(e1.token, [{ datos: PNG, tipo: 'image/png', nombre: 'a.png' }]);
    check('Emprendedor intenta publicar con fotos → 403', r.status === 403);
    r = await publicarConFotos(p2.token, [{ datos: Buffer.from('<script>alert(1)</script>'), tipo: 'image/png', nombre: 'falsa.png' }]);
    check('Archivo de texto disfrazado de PNG → 400', r.status === 400 && /no es una imagen/.test(r.data.message), JSON.stringify(r));
    r = await publicarConFotos(p2.token, [{ datos: Buffer.from('GIF89a'), tipo: 'image/gif', nombre: 'a.gif' }]);
    check('GIF (tipo no permitido) → 400', r.status === 400 && /JPG, PNG o WebP/.test(r.data.message), JSON.stringify(r));
    r = await publicarConFotos(p2.token, Array.from({ length: 6 }, (_, i) => ({ datos: PNG, tipo: 'image/png', nombre: `f${i}.png` })));
    check('6 fotos (máximo 5) → 400', r.status === 400 && /máximo 5/.test(r.data.message), JSON.stringify(r));
    r = await publicarConFotos(p2.token, [{ datos: Buffer.concat([PNG, Buffer.alloc(5.5 * 1024 * 1024)]), tipo: 'image/png', nombre: 'grande.png' }]);
    check('Foto de 5,5 MB (máximo 5 MB) → 400', r.status === 400 && /5 MB/.test(r.data.message), JSON.stringify(r));
    check('…y ninguno de los intentos rechazados creó una oferta', await contarOfertas() === ofertasAntes);

    r = await publicarConFotos(p2.token, [{ datos: PNG, tipo: 'image/png', nombre: 'frente.png' }, { datos: WEBP, tipo: 'image/webp', nombre: 'lado.webp' }]);
    check('Proveedor publica con 2 fotos (PNG y WebP)', r.status === 200 && r.data.fotos.length === 2, JSON.stringify(r));
    const urlsP2 = r.data.fotos || [];
    check('…los archivos reciben un nombre aleatorio del servidor', urlsP2.every(u => /^\/uploads\/ofertas\/[0-9a-f-]{36}\.(png|webp)$/.test(u)), JSON.stringify(urlsP2));
    let foto = await fetch(B + urlsP2[0]);
    check('…la foto se puede ver en el navegador (200, image/png, nosniff)', foto.status === 200 && foto.headers.get('content-type') === 'image/png' && foto.headers.get('x-content-type-options') === 'nosniff', `${foto.status} ${foto.headers.get('content-type')}`);
    const ofertaConFotos = (await api('GET', '/api/ofertas')).data.find(o => o.OfertaID === r.data.ofertaId);
    check('…/api/ofertas devuelve sus 2 fotos con la principal primero', ofertaConFotos && JSON.stringify(ofertaConFotos.Fotos) === JSON.stringify(urlsP2), JSON.stringify(ofertaConFotos));
    const filasFotos = await q('SELECT EsPrincipal FROM FotosOfertas WHERE OfertaID = ? ORDER BY FotoID', [r.data.ofertaId]);
    check('…se guardan en FotosOfertas (no como texto en Ofertas.Fotos)', filasFotos.length === 2 && filasFotos[0].EsPrincipal === 1 && filasFotos[1].EsPrincipal === 0);

    const sinFotos = await api('POST', '/api/ofertas', { token: p2.token, body: { ...campos, titulo: 'Oferta antigua' } });
    await q('UPDATE Ofertas SET Fotos = ? WHERE OfertaID = ?', [JSON.stringify(['data:image/png;base64,AAAA']), sinFotos.data.ofertaId]);
    const antigua = (await api('GET', '/api/ofertas')).data.find(o => o.OfertaID === sinFotos.data.ofertaId);
    check('Ofertas antiguas con fotos en texto se siguen mostrando', antigua && antigua.Fotos[0] === 'data:image/png;base64,AAAA', JSON.stringify(antigua));
    const subConFotos = (await api('GET', '/api/subastas')).data.find(x => x.OfertaID === r.data.ofertaId);
    check('La subasta muestra la foto principal de su publicación', subConFotos && subConFotos.Foto === urlsP2[0], JSON.stringify(subConFotos));
    const subAntigua = (await api('GET', '/api/subastas')).data.find(x => x.OfertaID === sinFotos.data.ofertaId);
    check('…también con las fotos antiguas en texto', subAntigua && subAntigua.Foto === 'data:image/png;base64,AAAA', JSON.stringify(subAntigua));

    foto = await fetch(B + '/uploads/%2e%2e/index.js');
    const textoFoto = await foto.text();
    check('/uploads no permite salir de la carpeta (../index.js)', foto.status === 404 && !textoFoto.includes('require('), `${foto.status}`);

    r = await api('DELETE', `/api/ofertas/${r.data.ofertaId}`, { token: p2.token });
    check('Borrar la oferta con fotos', r.status === 200);
    foto = await fetch(B + urlsP2[0]);
    check('…también borra los archivos del disco (404)', foto.status === 404 && (await fetch(B + urlsP2[1])).status === 404);
    r = await publicarConFotos(p1.token, [{ datos: PNG, tipo: 'image/png', nombre: 'p1.png' }], { titulo: 'Ojalillos niquelados' });
    check('Proveedor 1 publica con foto (para la prueba de eliminar usuario)', r.status === 200, JSON.stringify(r));
    const urlFotoP1 = r.data.fotos[0];

    // ---------------------------------------------------------------- CREAR SUBASTAS
    seccion('16. Crear subastas desde el Mercado');
    const lote = { tituloLote: 'Suela de hule (lote)', precioBase: 300, categoriaId: 13, dias: 3 };
    r = await api('POST', '/api/subastas', { body: lote });
    check('Crear subasta sin sesión → 401', r.status === 401);
    r = await api('POST', '/api/subastas', { token: e1.token, body: lote });
    check('Emprendedor intenta crear subasta → 403', r.status === 403);
    for (const [nombre, cambio] of [['0 días', { dias: 0 }], ['30 días', { dias: 30 }], ['1,5 días', { dias: 1.5 }], ['precio negativo', { precioBase: -1 }],
        ['sin título', { tituloLote: '  ' }], ['sin categoría', { categoriaId: null }], ['título de 121 letras', { tituloLote: 'x'.repeat(121) }]]) {
        r = await api('POST', '/api/subastas', { token: p2.token, body: { ...lote, ...cambio } });
        check(`Subasta con ${nombre} → 400`, r.status === 400, JSON.stringify(r));
    }
    r = await api('POST', '/api/subastas', { token: p2.token, body: { ...lote, categoriaId: 9999 } });
    check('Subasta con una categoría que no existe → 400', r.status === 400 && /categoría/.test(r.data.message), JSON.stringify(r));
    r = await api('POST', '/api/subastas', { token: p2.token, body: { ...lote, proveedorId: p1.id } });
    check('Proveedor 2 crea un lote nuevo de 3 días (enviando proveedorId falso)', r.status === 201 && r.data.subastaId, JSON.stringify(r));
    const loteNuevo = (await q('SELECT ProveedorID, OfertaID, CategoriaID, TituloLote, PrecioActual, TIMESTAMPDIFF(HOUR, NOW(), FechaFin) AS horas FROM Subastas WHERE SubastaID = ?', [r.data.subastaId]))[0];
    check('…queda a nombre del proveedor 2, sin publicación, con su categoría y precio', loteNuevo.ProveedorID === p2.id && loteNuevo.OfertaID === null && loteNuevo.CategoriaID === 13 && Number(loteNuevo.PrecioActual) === 300 && loteNuevo.TituloLote === 'Lote Subasta: Suela de hule (lote)', JSON.stringify(loteNuevo));
    check('…y cierra en 3 días', loteNuevo.horas >= 71 && loteNuevo.horas <= 72, `horas=${loteNuevo.horas}`);
    const enLista = (await api('GET', '/api/subastas')).data.find(x => x.SubastaID === r.data.subastaId);
    check('…y aparece en /api/subastas con su categoría', enLista && enLista.NombreCategoria === 'Suelas, Tacones y Tapas (Calzado)', JSON.stringify(enLista));

    // Desde una publicación: toma su título, categoría y fotos
    r = await publicarConFotos(p2.token, [{ datos: PNG, tipo: 'image/png', nombre: 'tachuelas.png' }], { titulo: 'Tachuelas de cobre', categoriaId: 7, precio: 80 });
    const ofTachuelas = r.data.ofertaId;
    const fotoTachuelas = r.data.fotos[0];
    r = await api('POST', '/api/subastas', { token: p2.token, body: { ofertaId: ofTachuelas, precioBase: 70 } });
    check('Subasta de una publicación que ya tiene subasta abierta → 409', r.status === 409 && /ya tiene una subasta abierta/.test(r.data.message), JSON.stringify(r));
    r = await api('POST', '/api/subastas', { token: p1.token, body: { ofertaId: ofTachuelas, precioBase: 70 } });
    check('Subasta con la publicación de otro proveedor → 404', r.status === 404, JSON.stringify(r));
    await q("UPDATE Subastas SET Estado = 'Finalizada' WHERE OfertaID = ?", [ofTachuelas]);
    const dobles = await Promise.all([1, 2, 3].map(() => api('POST', '/api/subastas', { token: p2.token, body: { ofertaId: ofTachuelas, precioBase: 70, categoriaId: 1 } })));
    check('3 clics a la vez para subastar la misma publicación: solo se crea UNA', dobles.filter(x => x.status === 201).length === 1 && dobles.filter(x => x.status === 409).length === 2, JSON.stringify(dobles.map(x => x.status)));
    const subTachuelas = (await api('GET', '/api/subastas')).data.find(x => x.OfertaID === ofTachuelas);
    check('…toma título, categoría (ignora la enviada) y foto de la publicación', subTachuelas && subTachuelas.TituloLote === 'Lote Subasta: Tachuelas de cobre' && subTachuelas.CategoriaID === 7 && subTachuelas.Foto === fotoTachuelas && Number(subTachuelas.PrecioBase) === 70, JSON.stringify(subTachuelas));

    // Borrar una publicación cuya subasta abierta tiene pujas
    r = await api('POST', '/api/pujas', { token: e1.token, body: { subastaId: subTachuelas.SubastaID, montoPuja: 75 } });
    check('Un emprendedor puja en la subasta de las tachuelas', r.status === 200, JSON.stringify(r));
    r = await api('DELETE', `/api/ofertas/${ofTachuelas}`, { token: p2.token });
    check('El proveedor NO puede borrar la publicación mientras su subasta tenga pujas → 409', r.status === 409 && r.data.pujas === 1 && /cuando la subasta cierre/.test(r.data.message), JSON.stringify(r));
    check('…la publicación y la subasta siguen igual', (await q('SELECT COUNT(*) n FROM Ofertas WHERE OfertaID = ?', [ofTachuelas]))[0].n === 1 && (await q('SELECT Estado FROM Subastas WHERE SubastaID = ?', [subTachuelas.SubastaID]))[0].Estado === 'Activa');
    r = await api('DELETE', `/api/admin/ofertas/${ofTachuelas}`, { token: admin.token });
    filaSub = (await q('SELECT Estado, OfertaID FROM Subastas WHERE SubastaID = ?', [subTachuelas.SubastaID]))[0];
    check('El admin sí puede (moderación): la subasta queda Cancelada y conserva sus pujas', r.status === 200 && filaSub.Estado === 'Cancelada' && filaSub.OfertaID === null && (await q('SELECT COUNT(*) n FROM Pujas WHERE SubastaID = ?', [subTachuelas.SubastaID]))[0].n === 1, JSON.stringify([r, filaSub]));
    check('…y la foto se borra del disco', (await fetch(B + fotoTachuelas)).status === 404);

    // Borrar una publicación cuya subasta no tiene pujas
    r = await api('POST', '/api/ofertas', { token: p2.token, body: { ...oferta, titulo: 'Cemento de contacto', categoriaId: 10 } });
    const subCemento = (await q('SELECT SubastaID FROM Subastas WHERE OfertaID = ?', [r.data.ofertaId]))[0];
    r = await api('DELETE', `/api/ofertas/${r.data.ofertaId}`, { token: p2.token });
    check('El proveedor borra una publicación sin pujas: su subasta se cancela y se lo avisa', r.status === 200 && r.data.subastasCanceladas === 1 && /también se canceló/.test(r.data.message), JSON.stringify(r));
    check('…estado Cancelada en la base', (await q('SELECT Estado FROM Subastas WHERE SubastaID = ?', [subCemento.SubastaID]))[0].Estado === 'Cancelada');

    // ---------------------------------------------------------------- CIERRE DE SUBASTAS
    seccion('14. Cierre automático de subastas');
    // subP1 venció en la sección 5 con pujas; el lote "Suela de hule (lote)" (proveedor 2, sección 16) se vence sin pujas
    const subP2 = (await q("SELECT SubastaID FROM Subastas WHERE ProveedorID = ? AND TituloLote = 'Lote Subasta: Suela de hule (lote)'", [p2.id]))[0];
    await q('UPDATE Subastas SET FechaFin = NOW() - INTERVAL 1 MINUTE WHERE SubastaID = ?', [subP2.SubastaID]);
    const listadas = (await api('GET', '/api/subastas')).data;
    check('Las subastas vencidas ya no aparecen en /api/subastas', !listadas.some(s => s.SubastaID === subP1.SubastaID || s.SubastaID === subP2.SubastaID));
    const mejor = (await q('SELECT EmprendedorID, MontoPuja FROM Pujas WHERE SubastaID = ? ORDER BY MontoPuja DESC LIMIT 1', [subP1.SubastaID]))[0];
    const ganador = mejor.EmprendedorID === e1.id ? e1 : e2;
    const perdedor = ganador === e1 ? e2 : e1;

    r = await api('POST', '/api/admin/subastas/cerrar-vencidas', { token: p1.token });
    check('Proveedor intenta forzar el cierre → 403', r.status === 403);
    r = await api('POST', '/api/admin/subastas/cerrar-vencidas', { token: admin.token });
    const cierreP1 = r.data && r.data.cerradas.find(c => c.subastaId === subP1.SubastaID);
    const cierreP2 = r.data && r.data.cerradas.find(c => c.subastaId === subP2.SubastaID);
    check('Admin cierra las vencidas: gana la puja más alta (590)', r.status === 200 && cierreP1 && cierreP1.ganadorId === ganador.id && cierreP1.monto === 590, JSON.stringify(r.data));
    check('…la subasta sin pujas se cierra sin ganador', cierreP2 && cierreP2.ganadorId === null);
    const estados = await q('SELECT SubastaID, Estado FROM Subastas WHERE SubastaID IN (?, ?)', [subP1.SubastaID, subP2.SubastaID]);
    check('…ambas quedan "Finalizada"', estados.length === 2 && estados.every(s => s.Estado === 'Finalizada'));
    const tratos = await q("SELECT * FROM TratosCerrados WHERE TipoOrigen = 'Subasta' AND OrigenID = ?", [subP1.SubastaID]);
    check('…se registra el trato (proveedor, ganador, C$590, Pendiente)', tratos.length === 1 && tratos[0].ProveedorID === p1.id && tratos[0].EmprendedorID === ganador.id && Number(tratos[0].MontoTotal) === 590 && tratos[0].EstadoTrato === 'Pendiente', JSON.stringify(tratos));
    const aviso = (await q('SELECT ContenidoTexto FROM MensajesChat WHERE RemitenteID = ? AND DestinatarioID = ? ORDER BY MensajeID DESC LIMIT 1', [p1.id, ganador.id]))[0];
    check('…y se abre el chat con un mensaje automático al ganador', aviso && /Ganaste la subasta/.test(aviso.ContenidoTexto), JSON.stringify(aviso));
    r = await api('POST', '/api/admin/subastas/cerrar-vencidas', { token: admin.token });
    const tratosOtraVez = (await q("SELECT COUNT(*) n FROM TratosCerrados WHERE OrigenID = ? AND TipoOrigen = 'Subasta'", [subP1.SubastaID]))[0].n;
    check('Volver a ejecutar el cierre no duplica nada', r.status === 200 && r.data.cerradas.length === 0 && tratosOtraVez === 1, JSON.stringify(r.data));
    r = await api('POST', '/api/pujas', { token: perdedor.token, body: { subastaId: subP1.SubastaID, montoPuja: 99999 } });
    check('Pujar en una subasta finalizada → 409', r.status === 409);

    r = await api('GET', '/api/tratos', { token: ganador.token });
    check('El ganador ve el trato en /api/tratos (contraparte: el proveedor)', r.status === 200 && r.data.length === 1 && !r.data[0].soyProveedor && r.data[0].contraparte === 'Curtiembre Uno' && r.data[0].monto === 590, JSON.stringify(r.data));
    r = await api('GET', '/api/tratos', { token: p1.token });
    check('El proveedor también lo ve, como vendedor', r.status === 200 && r.data.length === 1 && r.data[0].soyProveedor);
    r = await api('GET', '/api/tratos', { token: perdedor.token });
    check('Quien perdió no ve tratos ajenos', r.status === 200 && r.data.length === 0);
    r = await api('GET', '/api/tratos');
    check('/api/tratos sin sesión → 401', r.status === 401);
    r = await api('GET', '/api/dashboard', { token: ganador.token });
    check('Dashboard del ganador: 1 subasta ganada por C$590', r.status === 200 && r.data.miActividad.subastasGanadas === 1 && r.data.miActividad.montoGanado === 590, JSON.stringify(r.data && r.data.miActividad));
    r = await api('GET', '/api/dashboard', { token: p1.token });
    check('Dashboard del proveedor: 1 subasta vendida', r.status === 200 && r.data.miActividad.subastasVendidas === 1, JSON.stringify(r.data && r.data.miActividad));

    // ---------------------------------------------------------------- SEGUIMIENTO DE TRATOS
    seccion('17. Seguimiento de tratos');
    const tratoId = tratos[0].TratoID;
    const estadoTrato = async (id) => (await q('SELECT EstadoTrato FROM TratosCerrados WHERE TratoID = ?', [id]))[0].EstadoTrato;
    const ultimoMensaje = async (de, para) => ((await q('SELECT ContenidoTexto FROM MensajesChat WHERE RemitenteID = ? AND DestinatarioID = ? ORDER BY MensajeID DESC LIMIT 1', [de, para]))[0] || {}).ContenidoTexto || '';
    const cambiarTrato = (sesion, id, estado, extra = {}) => api('PUT', `/api/tratos/${id}/estado`, { token: sesion && sesion.token, body: { estado, ...extra } });

    r = await cambiarTrato(null, tratoId, 'EnProceso');
    check('Cambiar un trato sin sesión → 401', r.status === 401);
    r = await cambiarTrato(perdedor, tratoId, 'EnProceso');
    check('Alguien que no es parte del trato → 404 (no revela que existe)', r.status === 404, JSON.stringify(r));
    r = await cambiarTrato(admin, tratoId, 'Completado');
    check('El admin tampoco puede cambiar tratos ajenos → 404', r.status === 404);
    r = await cambiarTrato(ganador, tratoId, 'Pagado');
    check('Estado que no existe → 400', r.status === 400, JSON.stringify(r));
    r = await cambiarTrato(ganador, tratoId, 'Pendiente');
    check('Volver a "Pendiente" a mano → 400', r.status === 400);
    r = await cambiarTrato(ganador, 'abc', 'EnProceso');
    check('ID de trato inválido → 404', r.status === 404);
    check('…ninguno de esos intentos cambió el trato', await estadoTrato(tratoId) === 'Pendiente');

    r = await cambiarTrato(ganador, tratoId, 'EnProceso');
    check('El comprador marca el trato "En proceso"', r.status === 200 && r.data.estado === 'EnProceso' && r.data.estadoAnterior === 'Pendiente' && await estadoTrato(tratoId) === 'EnProceso', JSON.stringify(r));
    check('…y el proveedor recibe un aviso automático en el chat', /EN PROCESO/.test(await ultimoMensaje(ganador.id, p1.id)));
    r = await cambiarTrato(p1, tratoId, 'EnProceso');
    check('Marcarlo otra vez "En proceso" → 409', r.status === 409 && /ya está en proceso/.test(r.data.message), JSON.stringify(r));
    r = await api('GET', '/api/tratos', { token: p1.token });
    check('/api/tratos muestra el nuevo estado', r.data[0].estado === 'EnProceso');
    r = await cambiarTrato(p1, tratoId, 'Completado');
    check('El proveedor lo marca "Completado"', r.status === 200 && await estadoTrato(tratoId) === 'Completado', JSON.stringify(r));
    check('…y el comprador recibe el aviso', /COMPLETADO/.test(await ultimoMensaje(p1.id, ganador.id)));
    r = await cambiarTrato(ganador, tratoId, 'Cancelado');
    check('Un trato completado ya no se puede cancelar → 409', r.status === 409 && /completado/.test(r.data.message) && await estadoTrato(tratoId) === 'Completado', JSON.stringify(r));

    // Cancelar con motivo: deja de contar como subasta ganada / vendida
    const antes = (await api('GET', '/api/dashboard', { token: ganador.token })).data.miActividad;
    const tratoCancelar = (await q(`INSERT INTO TratosCerrados (ProveedorID, EmprendedorID, TipoOrigen, OrigenID, DescripcionResumen, MontoTotal, EstadoTrato, FechaCierre)
        VALUES (?, ?, 'Subasta', NULL, 'Subasta ganada: Lote Subasta: Hilo encerado', 100, 'Pendiente', NOW() - INTERVAL 2 DAY)`, [p2.id, ganador.id])).insertId;
    const conNuevo = (await api('GET', '/api/dashboard', { token: ganador.token })).data.miActividad;
    check('Un trato nuevo suma a "subastas ganadas"', conNuevo.subastasGanadas === antes.subastasGanadas + 1 && conNuevo.montoGanado === antes.montoGanado + 100, JSON.stringify([antes, conNuevo]));
    r = await api('GET', '/api/tratos', { token: ganador.token });
    check('/api/tratos pone primero los abiertos aunque sean más antiguos', r.data[0].id === tratoCancelar && r.data[1].estado === 'Completado', JSON.stringify(r.data.map(t => [t.id, t.estado])));
    r = await cambiarTrato(ganador, tratoCancelar, 'Cancelado', { motivo: '  El material <b>no</b> era el de la foto  ' + 'x'.repeat(300) });
    check('El comprador cancela un trato pendiente con motivo', r.status === 200 && await estadoTrato(tratoCancelar) === 'Cancelado', JSON.stringify(r));
    const avisoCancelado = await ultimoMensaje(ganador.id, p2.id);
    check('…el aviso del chat lleva el motivo (recortado a 200 letras)', /Cancelé el trato «Hilo encerado»\. Motivo: El material <b>no<\/b> era el de la foto\s+x+$/.test(avisoCancelado) && avisoCancelado.split('Motivo: ')[1].length === 200, avisoCancelado);
    const despues = (await api('GET', '/api/dashboard', { token: ganador.token })).data.miActividad;
    check('…y deja de contar como subasta ganada en el dashboard', despues.subastasGanadas === antes.subastasGanadas && despues.montoGanado === antes.montoGanado, JSON.stringify(despues));

    // Las dos partes pulsan a la vez
    const tratoDoble = (await q(`INSERT INTO TratosCerrados (ProveedorID, EmprendedorID, TipoOrigen, DescripcionResumen, MontoTotal, EstadoTrato)
        VALUES (?, ?, 'Subasta', 'Subasta ganada: Lote Subasta: Cuero doble', 50, 'Pendiente')`, [p2.id, ganador.id])).insertId;
    const aLaVez = await Promise.all([cambiarTrato(p2, tratoDoble, 'Completado'), cambiarTrato(ganador, tratoDoble, 'Cancelado')]);
    const ganoQuien = aLaVez[0].status === 200 ? 'Completado' : 'Cancelado';
    check('Proveedor completa y comprador cancela a la vez: solo uno gana y el otro recibe 409', aLaVez.filter(x => x.status === 200).length === 1 && aLaVez.filter(x => x.status === 409).length === 1 && await estadoTrato(tratoDoble) === ganoQuien, JSON.stringify(aLaVez.map(x => x.status)));

    // ---------------------------------------------------------------- EDITAR PUBLICACIONES
    seccion('18. Editar publicaciones');
    // Un proveedor nuevo, para no gastar el límite de publicaciones por hora del proveedor 2
    r = await reg('prov3@prueba.com', 'Proveedor', { nombre: 'Curtiembre Tres' });
    await verificar('prov3@prueba.com');
    const p3 = (await login('prov3@prueba.com', 'Clave123')).data;
    check('Proveedor 3 se registra, confirma su correo y entra', p3 && p3.token, JSON.stringify(p3));
    async function formulario(metodo, ruta, token, campos, archivos = []) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
        for (const a of archivos) fd.append('fotos', new Blob([a.datos], { type: a.tipo }), a.nombre);
        const resp = await fetch(B + ruta, { method: metodo, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd });
        let data = null;
        try { data = await resp.json(); } catch (e) { }
        return { status: resp.status, data };
    }
    r = await formulario('POST', '/api/ofertas', p3.token, { titulo: 'Badana cruda', precio: 90, unidad: 'pie²', distancia: 8, categoriaId: 1 },
        [{ datos: PNG, tipo: 'image/png', nombre: 'a.png' }, { datos: WEBP, tipo: 'image/webp', nombre: 'b.webp' }]);
    const ofEditar = r.data.ofertaId;
    const [fotoA, fotoB] = r.data.fotos;
    const subEditar = (await q('SELECT SubastaID FROM Subastas WHERE OfertaID = ?', [ofEditar]))[0].SubastaID;
    const cambios = { titulo: 'Badana curtida al vegetal', precio: 110, unidad: 'pie²', distancia: 5, categoriaId: 2 };

    r = await api('PUT', `/api/ofertas/${ofEditar}`, { body: cambios });
    check('Editar sin sesión → 401', r.status === 401);
    r = await api('PUT', `/api/ofertas/${ofEditar}`, { token: e1.token, body: cambios });
    check('Un emprendedor intenta editar → 403', r.status === 403);
    r = await api('PUT', `/api/ofertas/${ofEditar}`, { token: p2.token, body: cambios });
    check('Otro proveedor intenta editarla → 404 (no es suya)', r.status === 404, JSON.stringify(r));
    r = await api('PUT', '/api/ofertas/999999', { token: p3.token, body: cambios });
    check('Editar una publicación que no existe → 404', r.status === 404);
    for (const [nombre, cambio] of [['precio 0', { precio: 0 }], ['sin título', { titulo: ' ' }], ['unidad de 31 letras', { unidad: 'x'.repeat(31) }], ['fotosQuitar que no es lista', { fotosQuitar: { a: 1 } }]]) {
        r = await api('PUT', `/api/ofertas/${ofEditar}`, { token: p3.token, body: { ...cambios, ...cambio } });
        check(`Editar con ${nombre} → 400`, r.status === 400, JSON.stringify(r));
    }
    r = await api('PUT', `/api/ofertas/${ofEditar}`, { token: p3.token, body: { ...cambios, categoriaId: 9999 } });
    check('Editar con una categoría que no existe → 400', r.status === 400 && /categoría/.test(r.data.message), JSON.stringify(r));
    check('…ningún intento rechazado cambió la publicación', (await q('SELECT TituloMaterial FROM Ofertas WHERE OfertaID = ?', [ofEditar]))[0].TituloMaterial === 'Badana cruda');

    r = await formulario('PUT', `/api/ofertas/${ofEditar}`, p3.token, { ...cambios, fotosQuitar: JSON.stringify([fotoA]) }, [{ datos: PNG, tipo: 'image/png', nombre: 'c.png' }]);
    check('El dueño cambia datos, quita una foto y agrega otra', r.status === 200 && r.data.fotos.length === 2 && r.data.fotos[0] === fotoB && !r.data.fotos.includes(fotoA), JSON.stringify(r));
    const filaEditada = (await q('SELECT TituloMaterial, Precio, CategoriaID, DistanciaSimuladaKm FROM Ofertas WHERE OfertaID = ?', [ofEditar]))[0];
    check('…los datos nuevos quedan guardados', filaEditada.TituloMaterial === cambios.titulo && Number(filaEditada.Precio) === 110 && filaEditada.CategoriaID === 2 && filaEditada.DistanciaSimuladaKm === 5, JSON.stringify(filaEditada));
    check('…la foto quitada se borra del disco', (await fetch(B + fotoA)).status === 404 && (await fetch(B + r.data.fotos[1])).status === 200);
    const principales = await q('SELECT FotoURL FROM FotosOfertas WHERE OfertaID = ? AND EsPrincipal = 1', [ofEditar]);
    check('…y la que queda primero pasa a ser la principal (solo una)', principales.length === 1 && principales[0].FotoURL === fotoB, JSON.stringify(principales));
    const subEditada = (await q('SELECT TituloLote, CategoriaID, PrecioBase FROM Subastas WHERE SubastaID = ?', [subEditar]))[0];
    check('…su subasta abierta toma el título y la categoría nuevos (el precio no cambia)', subEditada.TituloLote === 'Lote Subasta: Badana curtida al vegetal' && subEditada.CategoriaID === 2 && Number(subEditada.PrecioBase) === 90, JSON.stringify(subEditada));

    r = await formulario('PUT', `/api/ofertas/${ofEditar}`, p3.token, cambios, Array.from({ length: 4 }, (_, i) => ({ datos: PNG, tipo: 'image/png', nombre: `n${i}.png` })));
    check('Pasar de 5 fotos en total → 400', r.status === 400 && /máximo 5/.test(r.data.message), JSON.stringify(r));
    check('…y no quedan fotos de más', (await q('SELECT COUNT(*) n FROM FotosOfertas WHERE OfertaID = ?', [ofEditar]))[0].n === 2);
    r = await api('PUT', `/api/ofertas/${ofEditar}`, { token: admin.token, body: { ...cambios, titulo: 'Badana curtida (revisada)' } });
    check('El administrador también puede editarla (sin tocar las fotos)', r.status === 200 && r.data.fotos.length === 2, JSON.stringify(r));

    // ---------------------------------------------------------------- PAGINACIÓN Y FILTROS
    seccion('19. Paginación y filtros');
    const totalOfertas = (await q('SELECT COUNT(*) n FROM Ofertas'))[0].n;
    const pag1 = (await api('GET', '/api/ofertas?pagina=1&porPagina=2')).data;
    const pag2 = (await api('GET', '/api/ofertas?pagina=2&porPagina=2')).data;
    check('Ofertas por páginas: total, páginas y 2 por página', pag1.total === totalOfertas && pag1.paginas === Math.ceil(totalOfertas / 2) && pag1.datos.length === Math.min(2, totalOfertas) && pag1.pagina === 1, JSON.stringify({ ...pag1, datos: pag1.datos.length }));
    check('…la página 2 no repite ofertas de la 1', pag2.datos.every(o => !pag1.datos.some(x => x.OfertaID === o.OfertaID)));
    r = await api('GET', '/api/ofertas?pagina=999&porPagina=2');
    check('Página que no existe → lista vacía con el total', r.status === 200 && r.data.datos.length === 0 && r.data.total === totalOfertas);
    r = await api('GET', '/api/ofertas?pagina=abc&porPagina=1000');
    check('Valores raros se corrigen (página 1, máximo 50 por página)', r.status === 200 && r.data.pagina === 1 && r.data.porPagina === 50);
    r = await api('GET', '/api/ofertas?pagina=1&q=BADANA');
    check('Buscar por texto (sin importar mayúsculas)', r.data.total === 1 && r.data.datos[0].OfertaID === ofEditar, JSON.stringify(r.data));
    r = await api('GET', '/api/ofertas?pagina=1&q=' + encodeURIComponent('%'));
    check('Un "%" en la búsqueda se toma literal (no trae todo)', r.data.total === 0, JSON.stringify(r.data.total));
    r = await api('GET', '/api/ofertas?pagina=1&porPagina=50&categoria=2');
    check('Filtrar por categoría', r.data.total >= 1 && r.data.datos.every(o => o.CategoriaID === 2));
    r = await api('GET', '/api/ofertas?pagina=1&porPagina=50&maxKm=4');
    check('Filtrar por distancia máxima', r.data.datos.every(o => o.DistanciaSimuladaKm <= 4) && r.data.total === (await q('SELECT COUNT(*) n FROM Ofertas WHERE DistanciaSimuladaKm <= 4'))[0].n);
    r = await api('GET', `/api/ofertas?proveedorId=${p3.id}`);
    check('Sin ?pagina devuelve la lista (filtrada por proveedor) con su nombre', Array.isArray(r.data) && r.data.length === 1 && r.data[0].NombreProveedor === 'Curtiembre Tres' && r.data[0].TotalCalificaciones === 0 && r.data[0].CalificacionProveedor === null, JSON.stringify(r.data));
    const subastasAbiertas = (await q("SELECT COUNT(*) n FROM Subastas WHERE Estado = 'Activa' AND FechaFin > NOW()"))[0].n;
    r = await api('GET', '/api/subastas?pagina=1&porPagina=1');
    check('Subastas por páginas', r.data.total === subastasAbiertas && r.data.datos.length === Math.min(1, subastasAbiertas), JSON.stringify(r.data));
    r = await api('GET', '/api/subastas?pagina=1&q=badana');
    check('Buscar subastas por texto', r.data.total === 1 && r.data.datos[0].SubastaID === subEditar, JSON.stringify(r.data));
    const totalUsuarios = (await q('SELECT COUNT(*) n FROM Usuarios'))[0].n;
    r = await api('GET', '/api/admin/usuarios?pagina=1&porPagina=2', { token: admin.token });
    check('Admin: usuarios por páginas', r.data.total === totalUsuarios && r.data.datos.length === 2, JSON.stringify(r.data && r.data.total));
    r = await api('GET', '/api/admin/usuarios?pagina=1&buscar=prov3', { token: admin.token });
    check('Admin: buscar usuarios por correo', r.data.total === 1 && r.data.datos[0].UsuarioID === p3.id);
    r = await api('GET', '/api/admin/usuarios?pagina=1', { token: p3.token });
    check('…un proveedor no puede listar usuarios → 403', r.status === 403);

    // ---------------------------------------------------------------- MENSAJES NO LEÍDOS
    seccion('20. Mensajes no leídos');
    r = await api('GET', '/api/chat/no-leidos');
    check('Contador sin sesión → 401', r.status === 401);
    const noLeidosAntes = (await api('GET', '/api/chat/no-leidos', { token: e1.token })).data;
    await api('POST', '/api/chat/enviar', { token: p3.token, body: { destinatarioId: e1.id, texto: '¿Le interesa la badana?' } });
    await api('POST', '/api/chat/enviar', { token: p3.token, body: { destinatarioId: e1.id, texto: 'Tengo 40 pies' } });
    r = await api('GET', '/api/chat/no-leidos', { token: e1.token });
    check('El emprendedor tiene 2 mensajes sin leer del proveedor 3', r.data.porContacto[p3.id] === 2 && r.data.total === noLeidosAntes.total + 2, JSON.stringify([noLeidosAntes, r.data]));
    r = await api('GET', '/api/chat/contactos', { token: e1.token });
    check('…en sus contactos aparece primero alguien con mensajes sin leer, y el proveedor 3 con 2', r.data[0].NoLeidos > 0 && r.data.find(c => c.UsuarioID === p3.id).NoLeidos === 2, JSON.stringify(r.data.slice(0, 3)));
    await api('GET', `/api/chat/mensajes?destinatarioId=${p3.id}`, { token: p2.token });
    check('Que otra persona abra SU chat con el proveedor 3 no los marca leídos', (await api('GET', '/api/chat/no-leidos', { token: e1.token })).data.porContacto[p3.id] === 2);
    r = await api('GET', `/api/chat/mensajes?destinatarioId=${p3.id}`, { token: e1.token });
    check('Al abrir la conversación se ven los 2 mensajes', r.status === 200 && r.data.length === 2);
    r = await api('GET', '/api/chat/no-leidos', { token: e1.token });
    check('…y quedan leídos (el contador baja)', !r.data.porContacto[p3.id] && r.data.total === noLeidosAntes.total, JSON.stringify(r.data));
    r = await api('GET', `/api/chat/mensajes?destinatarioId=${e1.id}`, { token: p3.token });
    check('El proveedor 3 ve sus mensajes como "Visto"', r.data.length === 2 && r.data.every(m => m.EsLeido === true), JSON.stringify(r.data));

    // ---------------------------------------------------------------- CALIFICACIONES
    seccion('21. Calificaciones de los tratos');
    const calificar = (sesion, id, body) => api('POST', `/api/tratos/${id}/calificacion`, { token: sesion && sesion.token, body });
    r = await calificar(null, tratoId, { puntuacion: 5 });
    check('Calificar sin sesión → 401', r.status === 401);
    r = await calificar(perdedor, tratoId, { puntuacion: 5 });
    check('Alguien que no es parte del trato → 404', r.status === 404);
    for (const mala of [0, 6, 4.5, 'cinco', null]) {
        r = await calificar(ganador, tratoId, { puntuacion: mala });
        check(`Puntuación ${JSON.stringify(mala)} → 400`, r.status === 400, JSON.stringify(r));
    }
    r = await calificar(ganador, tratoCancelar, { puntuacion: 3 });
    check('Un trato cancelado no se califica → 409', r.status === 409 && /completado/.test(r.data.message), JSON.stringify(r));
    r = await calificar(ganador, tratoId, { puntuacion: 4, comentario: '  Buen cuero, entrega puntual ' + 'x'.repeat(400) });
    check('El comprador califica al proveedor con 4 estrellas', r.status === 201 && r.data.calificadoId === p1.id, JSON.stringify(r));
    const filaCal = (await q('SELECT Puntuacion, Comentario FROM Calificaciones WHERE TratoID = ? AND AutorID = ?', [tratoId, ganador.id]))[0];
    check('…el comentario se guarda recortado a 300 letras', filaCal.Puntuacion === 4 && filaCal.Comentario.startsWith('Buen cuero') && filaCal.Comentario.length === 300, JSON.stringify(filaCal).slice(0, 120));
    check('…y el proveedor recibe un aviso en el chat', /4 de 5 estrellas/.test(await ultimoMensaje(ganador.id, p1.id)));
    r = await calificar(ganador, tratoId, { puntuacion: 1 });
    check('Calificar dos veces el mismo trato → 409', r.status === 409 && /Ya calificaste/.test(r.data.message));
    r = await calificar(p1, tratoId, { puntuacion: 5 });
    check('El proveedor también califica al comprador', r.status === 201 && r.data.calificadoId === ganador.id, JSON.stringify(r));
    r = await api('GET', '/api/tratos', { token: ganador.token });
    const tratoCalificado = r.data.find(t => t.id === tratoId);
    check('/api/tratos muestra mi calificación y la que me dieron', tratoCalificado.miCalificacion === 4 && tratoCalificado.suCalificacion === 5, JSON.stringify(tratoCalificado));
    r = await api('GET', `/api/usuarios/${p1.id}/reputacion`, { token: e1.token });
    check('Reputación del proveedor: promedio 4 de 1 calificación, con el comentario', r.status === 200 && r.data.promedio === 4 && r.data.total === 1 && r.data.ultimas[0].comentario.startsWith('Buen cuero'), JSON.stringify(r.data).slice(0, 200));
    r = await api('GET', `/api/usuarios/${p1.id}/reputacion`);
    check('…ver la reputación pide sesión (401)', r.status === 401);
    r = await api('GET', `/api/ofertas?proveedorId=${p1.id}`);
    check('Las ofertas del proveedor muestran su calificación en el Mercado', r.data.length >= 1 && r.data.every(o => o.CalificacionProveedor === 4 && o.TotalCalificaciones === 1), JSON.stringify(r.data.map(o => [o.CalificacionProveedor, o.TotalCalificaciones])));
    r = await api('GET', '/api/dashboard', { token: p1.token });
    check('El dashboard muestra "Mi calificación"', r.data.miActividad.miCalificacion === 4 && r.data.miActividad.misCalificaciones === 1, JSON.stringify(r.data.miActividad));

    // ---------------------------------------------------------------- AVISOS AL CANCELAR SUBASTAS
    seccion('22. Avisar a quienes pujaron si se cancela una subasta');
    r = await api('POST', '/api/ofertas', { token: p3.token, body: { titulo: 'Hilo encerado 1mm', precio: 40, unidad: 'rollo', distancia: 3, categoriaId: 9 } });
    const ofHilo = r.data.ofertaId;
    const subHilo = (await q('SELECT SubastaID FROM Subastas WHERE OfertaID = ?', [ofHilo]))[0].SubastaID;
    const pujaHilo1 = await api('POST', '/api/pujas', { token: e1.token, body: { subastaId: subHilo, montoPuja: 45 } });
    const pujaHilo2 = await api('POST', '/api/pujas', { token: e2.token, body: { subastaId: subHilo, montoPuja: 50 } });
    const pujaHilo3 = await api('POST', '/api/pujas', { token: e1.token, body: { subastaId: subHilo, montoPuja: 55 } });
    check('Dos emprendedores pujan (uno de ellos dos veces)', [pujaHilo1, pujaHilo2, pujaHilo3].every(x => x.status === 200));
    r = await api('DELETE', `/api/admin/ofertas/${ofHilo}`, { token: admin.token });
    check('El admin retira la publicación: avisa a las 2 personas que pujaron', r.status === 200 && r.data.pujadoresAvisados === 2 && /Avisamos por el chat a 2/.test(r.data.message), JSON.stringify(r));
    const avisoE1 = await q('SELECT ContenidoTexto FROM MensajesChat WHERE RemitenteID = ? AND DestinatarioID = ? AND ContenidoTexto LIKE ?', [admin.id, e1.id, '%Hilo encerado 1mm%']);
    const avisoE2 = await q('SELECT ContenidoTexto FROM MensajesChat WHERE RemitenteID = ? AND DestinatarioID = ? AND ContenidoTexto LIKE ?', [admin.id, e2.id, '%Hilo encerado 1mm%']);
    check('…cada una recibe UN mensaje que explica la cancelación', avisoE1.length === 1 && avisoE2.length === 1 && /cancelada por moderación del administrador/.test(avisoE1[0].ContenidoTexto), JSON.stringify(avisoE1));
    // Para la sección 12: una subasta abierta del proveedor 1 con una puja del emprendedor 1
    r = await api('POST', '/api/ofertas', { token: p1.token, body: { titulo: 'Suela crepé', precio: 60, unidad: 'par', distancia: 2, categoriaId: 13 } });
    const subSuela = (await q('SELECT SubastaID FROM Subastas WHERE OfertaID = ?', [r.data.ofertaId]))[0].SubastaID;
    r = await api('POST', '/api/pujas', { token: e1.token, body: { subastaId: subSuela, montoPuja: 65 } });
    check('El emprendedor 1 puja en una subasta abierta del proveedor 1', r.status === 200, JSON.stringify(r));

    // ---------------------------------------------------------------- CORREOS INVÁLIDOS Y CONFIRMACIÓN
    seccion('23. Correos inválidos y confirmación por el admin');
    const roto = await q("INSERT INTO Usuarios (CorreoElectronico, ContrasenaHash, TipoRol) VALUES ('roto@gmail', 'clave_rota', 'Emprendedor')");
    await q("INSERT INTO PerfilesUsuarios (UsuarioID, NombreRazonSocial, TelefonoWhatsApp, DepartamentoID) VALUES (?, 'Taller Roto', '88882222', 1)", [roto.insertId]);
    r = await login('roto@gmail', 'clave_rota');
    check('Una cuenta con correo sin ".com" no puede entrar (400)', r.status === 400);
    r = await api('GET', '/api/admin/metricas', { token: admin.token });
    check('Las métricas del admin cuentan los correos inválidos', r.data.correosInvalidos === 1, JSON.stringify(r.data));
    r = await api('GET', '/api/admin/usuarios?pagina=1&problemas=1', { token: admin.token });
    check('…y el filtro "con problemas" la muestra marcada como inválida', r.data.datos.some(u => u.UsuarioID === roto.insertId && u.CorreoValido === false), JSON.stringify(r.data.datos));
    r = await api('PUT', `/api/admin/usuarios/${roto.insertId}/correo`, { token: p3.token, body: { correo: 'roto@gmail.com' } });
    check('Un proveedor no puede corregir correos → 403', r.status === 403);
    r = await api('PUT', `/api/admin/usuarios/${roto.insertId}/correo`, { token: admin.token, body: { correo: 'roto@gmail' } });
    check('Corregir con otro correo inválido → 400', r.status === 400);
    r = await api('PUT', `/api/admin/usuarios/${roto.insertId}/correo`, { token: admin.token, body: { correo: 'prov2@prueba.com' } });
    check('Corregir con el correo de otra cuenta → 409', r.status === 409, JSON.stringify(r));
    r = await api('PUT', '/api/admin/usuarios/999999/correo', { token: admin.token, body: { correo: 'nuevo@prueba.com' } });
    check('Corregir el correo de un usuario que no existe → 404', r.status === 404);
    r = await api('PUT', `/api/admin/usuarios/${roto.insertId}/correo`, { token: admin.token, body: { correo: 'roto@gmail.com' } });
    check('El admin corrige el correo', r.status === 200, JSON.stringify(r));
    r = await login('roto@gmail.com', 'clave_rota');
    check('…y la persona ya puede entrar con su contraseña de siempre', r.status === 200, JSON.stringify(r));
    check('…y ya no quedan correos inválidos', (await api('GET', '/api/admin/metricas', { token: admin.token })).data.correosInvalidos === 0);

    r = await reg('pendiente@prueba.com', 'Emprendedor', { nombre: 'Taller Pendiente' });
    const pendienteId = (await q("SELECT UsuarioID FROM Usuarios WHERE CorreoElectronico = 'pendiente@prueba.com'"))[0].UsuarioID;
    check('Las métricas cuentan las cuentas sin confirmar', (await api('GET', '/api/admin/metricas', { token: admin.token })).data.cuentasSinVerificar === 1);
    r = await api('PUT', `/api/admin/usuarios/${pendienteId}/verificar`, { token: admin.token });
    check('El admin da por confirmado un correo (si no le llega el enlace)', r.status === 200 && (await login('pendiente@prueba.com', 'Clave123')).status === 200, JSON.stringify(r));

    r = await reg('olvido@prueba.com', 'Emprendedor', { nombre: 'Taller Olvido' });
    await q("UPDATE Usuarios SET TokenRecuperacion = 'tok-olvido', ExpiracionToken = NOW() + INTERVAL 1 HOUR WHERE CorreoElectronico = 'olvido@prueba.com'");
    r = await api('POST', '/api/restablecer-password', { body: { token: 'tok-olvido', nuevaContrasena: 'NuevaClave9' } });
    const filaOlvido = (await q("SELECT CorreoVerificado FROM Usuarios WHERE CorreoElectronico = 'olvido@prueba.com'"))[0];
    check('Restablecer la contraseña con el enlace del correo también lo confirma', r.status === 200 && filaOlvido.CorreoVerificado === 1 && (await login('olvido@prueba.com', 'NuevaClave9')).status === 200);

    r = await reg('tarde@prueba.com', 'Emprendedor', { nombre: 'Taller Tarde' });
    await q("UPDATE Usuarios SET ExpiracionVerificacion = NOW() - INTERVAL 1 MINUTE WHERE CorreoElectronico = 'tarde@prueba.com'");
    r = await verificar('tarde@prueba.com');
    check('Un enlace de confirmación vencido → 400', r.status === 400);
    await api('POST', '/api/reenviar-verificacion', { body: { email: 'tarde@prueba.com' } });
    r = await verificar('tarde@prueba.com');
    check('…se pide uno nuevo y ese sí funciona', r.status === 200 && (await login('tarde@prueba.com', 'Clave123')).status === 200, JSON.stringify(r));

    seccion('12. Eliminar usuarios (admin)');
    r = await api('DELETE', `/api/admin/usuarios/${admin.id}`, { token: admin.token });
    check('Admin no puede eliminarse a sí mismo → 400', r.status === 400);
    r = await api('DELETE', `/api/admin/usuarios/${e2.id}`, { token: p1.token });
    check('Proveedor intenta eliminar usuario → 403', r.status === 403);
    r = await api('DELETE', `/api/admin/usuarios/${e2.id}`, { token: admin.token });
    check('Eliminar emprendedor con pujas y mensajes', r.status === 200, JSON.stringify(r));
    const restos = (await q('SELECT (SELECT COUNT(*) FROM Pujas WHERE EmprendedorID=?) p, (SELECT COUNT(*) FROM MensajesChat WHERE RemitenteID=? OR DestinatarioID=?) m, (SELECT COUNT(*) FROM PerfilesUsuarios WHERE UsuarioID=?) pf', [e2.id, e2.id, e2.id, e2.id]))[0];
    check('…sin dejar pujas, mensajes ni perfil huérfanos', restos.p === 0 && restos.m === 0 && restos.pf === 0, JSON.stringify(restos));
    r = await api('DELETE', `/api/admin/usuarios/${p1.id}`, { token: admin.token });
    check('Eliminar proveedor con subastas, pujas recibidas, calificaciones y mensajes', r.status === 200, JSON.stringify(r));
    const avisoBaja = (await q('SELECT ContenidoTexto FROM MensajesChat WHERE RemitenteID = ? AND DestinatarioID = ? ORDER BY MensajeID DESC LIMIT 1', [admin.id, e1.id]))[0];
    check('…y avisó por el chat a quien pujaba en su subasta abierta', r.data.pujadoresAvisados === 1 && /Suela crepé/.test(avisoBaja.ContenidoTexto) && /dada de baja/.test(avisoBaja.ContenidoTexto), JSON.stringify([r.data, avisoBaja]));
    check('…sin dejar calificaciones huérfanas', (await q('SELECT COUNT(*) n FROM Calificaciones WHERE AutorID = ? OR CalificadoID = ?', [p1.id, p1.id]))[0].n === 0);
    const restosP = (await q('SELECT (SELECT COUNT(*) FROM Subastas WHERE ProveedorID=?) s, (SELECT COUNT(*) FROM Ofertas WHERE ProveedorID=?) o', [p1.id, p1.id]))[0];
    check('…sin dejar subastas ni ofertas huérfanas', restosP.s === 0 && restosP.o === 0, JSON.stringify(restosP));
    r = await api('GET', '/api/chat/contactos', { token: p1.token });
    check('…y el token del usuario eliminado deja de funcionar (401)', r.status === 401);
    r = await api('DELETE', `/api/admin/usuarios/999999`, { token: admin.token });
    check('Eliminar usuario inexistente → 404', r.status === 404);
    check('Eliminar al proveedor 1 también borró del disco las fotos de sus ofertas', (await fetch(B + urlFotoP1)).status === 404);

    // ---------------------------------------------------------------- LÍMITES (al final: bloquean esta IP)
    seccion('15. Límites de intentos');
    const hasta429 = async (peticion, maximo) => {
        for (let i = 1; i <= maximo; i++) {
            const resp = await peticion(i);
            if (resp.status === 429) return { intentos: i, resp };
        }
        return { intentos: null, resp: null };
    };
    let limite = await hasta429(() => login('noexiste@prueba.com', 'Equivocada1'), 40);
    check('Login: tras varios intentos fallidos responde 429', limite.intentos !== null && limite.intentos <= 31, `intentos=${limite.intentos}`);
    check('…con un mensaje claro y cuánto esperar', limite.resp && /Demasiados intentos fallidos/.test(limite.resp.data.message) && limite.resp.data.reintentarEnSegundos > 0, JSON.stringify(limite.resp && limite.resp.data));
    r = await login('emp1@prueba.com', 'Clave123');
    check('…y mientras dure el bloqueo tampoco deja probar más contraseñas', r.status === 429);

    limite = await hasta429(() => api('POST', '/api/chat/ia', { token: e1.token, body: { mensajeUsuario: 'hola' } }), 15);
    check('Kan: más de 10 preguntas por minuto del mismo usuario → 429', limite.intentos !== null && limite.intentos <= 11, `intentos=${limite.intentos}`);
    r = await api('POST', '/api/chat/ia', { token: admin.token, body: { mensajeUsuario: 'hola' } });
    check('…el límite de Kan es por usuario: otro usuario sigue pudiendo preguntar', r.status === 200);

    limite = await hasta429((i) => reg(`masivo${i}@prueba.com`, 'Emprendedor'), 50);
    check('Registro: crear cuentas sin parar desde la misma IP → 429', limite.intentos !== null, `intentos=${limite.intentos}`);

    await db.end();
    console.log(resultados.join('\n'));
    console.log(`\nRESULTADO: ${ok} correctas, ${fallos} fallidas`);
    // Se guardan los tokens para la prueba en navegador
    require('fs').writeFileSync(__dirname + '/sesiones_prueba.json', JSON.stringify(sesiones));
    process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR EN LA PRUEBA:', e); process.exit(2); });
