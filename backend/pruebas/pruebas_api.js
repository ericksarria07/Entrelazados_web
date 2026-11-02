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
    const db = await mysql.createConnection({ host: 'localhost', user: 'entrelazados_pruebas', password: dbPass, database: 'entrelazados_pruebas' });
    const q = async (sql, p = []) => (await db.query(sql, p))[0];

    // ---------------------------------------------------------------- REGISTRO
    seccion('1. Registro');
    const reg = (email, rol, extra = {}) => api('POST', '/registro', { body: { nombre: extra.nombre || email.split('@')[0], email, telefono: '88887777', rol, deptoId: 'Managua', password: 'Clave123', ...extra } });
    let r = await reg('prov1@prueba.com', 'Proveedor', { nombre: 'Curtiembre Uno' });
    check('Registrar proveedor 1', r.status === 200, JSON.stringify(r));
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

    // ---------------------------------------------------------------- LOGIN
    seccion('2. Inicio de sesión');
    const login = async (email, password) => api('POST', '/api/login', { body: { email, password } });
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
    await q("UPDATE Ofertas SET Fotos = '{no es json' WHERE OfertaID = ?", [ofP2.OfertaID]);
    r = await api('GET', '/api/ofertas');
    check('Fotos con JSON dañado no tumban /api/ofertas', r.status === 200 && r.data.length === 2);

    // ---------------------------------------------------------------- SUBASTAS Y PUJAS
    seccion('5. Subastas y pujas');
    const subastas = (await api('GET', '/api/subastas')).data;
    check('Cada oferta creó su subasta', subastas.length === 2);
    const subP1 = subastas.find(s => s.ProveedorID === p1.id);
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
    r = await api('DELETE', `/api/ofertas/${ofP2.OfertaID}`, { token: admin.token });
    check('Admin puede borrar cualquier oferta', r.status === 200);

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
    check('Kan responde', r.status === 200 && /Kan/.test(r.data.respuesta));

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
    check('Eliminar proveedor con subastas, pujas recibidas y mensajes', r.status === 200, JSON.stringify(r));
    const restosP = (await q('SELECT (SELECT COUNT(*) FROM Subastas WHERE ProveedorID=?) s, (SELECT COUNT(*) FROM Ofertas WHERE ProveedorID=?) o', [p1.id, p1.id]))[0];
    check('…sin dejar subastas ni ofertas huérfanas', restosP.s === 0 && restosP.o === 0, JSON.stringify(restosP));
    r = await api('GET', '/api/chat/contactos', { token: p1.token });
    check('…y el token del usuario eliminado deja de funcionar (401)', r.status === 401);
    r = await api('DELETE', `/api/admin/usuarios/999999`, { token: admin.token });
    check('Eliminar usuario inexistente → 404', r.status === 404);

    await db.end();
    console.log(resultados.join('\n'));
    console.log(`\nRESULTADO: ${ok} correctas, ${fallos} fallidas`);
    // Se guardan los tokens para la prueba en navegador
    require('fs').writeFileSync(__dirname + '/sesiones_prueba.json', JSON.stringify(sesiones));
    process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR EN LA PRUEBA:', e); process.exit(2); });
