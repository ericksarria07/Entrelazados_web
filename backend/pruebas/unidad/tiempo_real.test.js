// Pruebas unitarias de las notificaciones y del tiempo real (sin MySQL: la base de datos
// es un objeto falso). La de tiempo real levanta un servidor Socket.IO de verdad en un
// puerto libre y se conecta con el cliente oficial, igual que lo hace el navegador.
const { silenciarConsola } = require('./ayudas');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const { io: clienteIo } = require('socket.io-client');
const { crearTiempoReal, tiempoRealNulo } = require('../../entrelazados-api/servicios/tiempoReal');
const { crearServicioNotificaciones } = require('../../entrelazados-api/servicios/notificaciones');
const { mesesDelPeriodo } = require('../../entrelazados-api/rutas/reportes');

const SECRETO = 'secreto-tiempo-real';

// ---------------------------------------------------------------- NOTIFICACIONES

// Base de datos falsa que imita la tabla Notificaciones en memoria
function dbNotificaciones() {
    const filas = [];
    return {
        filas,
        async query(sql, p) {
            if (sql.startsWith('UPDATE Notificaciones SET Titulo')) {
                const [titulo, mensaje, enlace, usuarioId, tipo, referenciaId] = p;
                const f = [...filas].reverse().find(x => x.UsuarioID === usuarioId && x.Tipo === tipo && x.ReferenciaID === referenciaId && !x.EsLeida);
                if (f) Object.assign(f, { Titulo: titulo, Mensaje: mensaje, Enlace: enlace });
                return [{ affectedRows: f ? 1 : 0 }];
            }
            if (sql.startsWith('SELECT * FROM Notificaciones WHERE UsuarioID = ? AND Tipo')) {
                const [usuarioId, tipo, referenciaId] = p;
                return [[[...filas].reverse().find(x => x.UsuarioID === usuarioId && x.Tipo === tipo && x.ReferenciaID === referenciaId && !x.EsLeida)]];
            }
            if (sql.startsWith('INSERT INTO Notificaciones')) {
                const [UsuarioID, Tipo, Titulo, Mensaje, Enlace, ReferenciaID] = p;
                filas.push({ NotificacionID: filas.length + 1, UsuarioID, Tipo, Titulo, Mensaje, Enlace, ReferenciaID, EsLeida: 0, FechaCreacion: new Date() });
                return [{ insertId: filas.length }];
            }
            if (sql.startsWith('SELECT * FROM Notificaciones WHERE NotificacionID')) {
                return [[filas.find(x => x.NotificacionID === p[0])]];
            }
            if (sql.startsWith('SELECT UsuarioID, CorreoElectronico')) {
                return [p[0].map(id => ({ UsuarioID: id, CorreoElectronico: `u${id}@prueba.com` }))];
            }
            throw new Error('Consulta no prevista en la prueba: ' + sql.slice(0, 60));
        }
    };
}

// Tiempo real falso: anota cada evento emitido
function tiempoRealEspia() {
    const emitidos = [];
    return { emitidos, aUsuario: (ids, evento, datos) => [].concat(ids).forEach(id => emitidos.push({ id, evento, datos })) };
}

test('enviar() guarda la notificación y la empuja al usuario al instante', async () => {
    const db = dbNotificaciones();
    const tiempoReal = tiempoRealEspia();
    const servicio = crearServicioNotificaciones({ db, tiempoReal });
    await servicio.enviar([{ usuarioId: 5, tipo: 'SubastaGanada', titulo: '¡Ganaste!', mensaje: 'Felicidades', enlace: 'chat.html', referenciaId: 9 }]);
    assert.equal(db.filas.length, 1);
    assert.equal(tiempoReal.emitidos.length, 1);
    const { id, evento, datos } = tiempoReal.emitidos[0];
    assert.equal(id, 5);
    assert.equal(evento, 'notificacion:nueva');
    assert.deepEqual({ ...datos, fecha: undefined }, {
        id: 1, tipo: 'SubastaGanada', titulo: '¡Ganaste!', mensaje: 'Felicidades', enlace: 'chat.html',
        referenciaId: 9, leida: false, fecha: undefined
    });
});

test('agrupar: una igual SIN LEER se actualiza en vez de crear otra', async () => {
    const db = dbNotificaciones();
    const servicio = crearServicioNotificaciones({ db, tiempoReal: tiempoRealEspia() });
    const aviso = (monto) => ({ usuarioId: 3, tipo: 'PujaSuperada', titulo: 'Te superaron', mensaje: `C$${monto}`, referenciaId: 8, agrupar: true });
    await servicio.enviar([aviso(100)]);
    await servicio.enviar([aviso(200)]);
    assert.equal(db.filas.length, 1);
    assert.equal(db.filas[0].Mensaje, 'C$200');
    db.filas[0].EsLeida = 1;   // ya la leyó: la siguiente es una nueva
    await servicio.enviar([aviso(300)]);
    assert.equal(db.filas.length, 2);
});

test('el correo se manda solo para avisos nuevos (no al agruparlos) y solo si está configurado', async () => {
    const enviados = [];
    const correo = { configurado: true, enviarAviso: async (destino, aviso) => enviados.push({ destino, aviso }) };
    const servicio = crearServicioNotificaciones({ db: dbNotificaciones(), tiempoReal: tiempoRealEspia(), correo, urlBase: 'https://entrelazados.com' });
    const aviso = { usuarioId: 4, tipo: 'PujaSuperada', titulo: 'Te superaron', mensaje: 'x', enlace: 'mercado.html', referenciaId: 1, agrupar: true,
        correo: { asunto: 'Te superaron', parrafos: ['x'] } };
    await servicio.enviar([aviso]);
    await servicio.enviar([aviso]);
    await new Promise(r => setImmediate(r));
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].destino, 'u4@prueba.com');
    assert.equal(enviados[0].aviso.boton.enlace, 'https://entrelazados.com/mercado.html');

    const sinCorreo = crearServicioNotificaciones({ db: dbNotificaciones(), tiempoReal: tiempoRealEspia(), correo: { configurado: false } });
    await sinCorreo.enviar([aviso]);   // no lanza aunque no haya correo
});

test('enviar() nunca rompe la acción principal aunque la base falle', async () => {
    const db = { query: async () => { throw new Error('la base no responde'); } };
    const servicio = crearServicioNotificaciones({ db, tiempoReal: tiempoRealEspia() });
    await silenciarConsola(() => servicio.enviar([{ usuarioId: 1, tipo: 'PujaRecibida', mensaje: 'x' }]));
});

test('enviar() ignora avisos sin usuario o sin tipo, y recorta los textos largos', async () => {
    const db = dbNotificaciones();
    const servicio = crearServicioNotificaciones({ db, tiempoReal: tiempoRealEspia() });
    await servicio.enviar([null, { tipo: 'PujaRecibida' }, { usuarioId: 2 }, { usuarioId: 2, tipo: 'PujaRecibida', titulo: 't'.repeat(500), mensaje: 'm'.repeat(500) }]);
    assert.equal(db.filas.length, 1);
    assert.equal(db.filas[0].Titulo.length, 120);
    assert.equal(db.filas[0].Mensaje.length, 300);
});

test('mesesDelPeriodo da todos los meses del periodo, aunque cambie el año', () => {
    assert.deepEqual(mesesDelPeriodo(new Date(2026, 9, 1), 4), ['2026-10', '2026-11', '2026-12', '2027-01']);
    assert.equal(mesesDelPeriodo(new Date(2026, 0, 1), 12).length, 12);
});

test('tiempoRealNulo no hace nada y no falla (pruebas y scripts sin servidor)', async () => {
    tiempoRealNulo.aUsuario(1, 'x', {});
    tiempoRealNulo.aTodos('x', {});
    tiempoRealNulo.desconectarUsuario(1);
    assert.equal(tiempoRealNulo.conectados(), 0);
    await tiempoRealNulo.cerrar();
});

// ---------------------------------------------------------------- SOCKET.IO DE VERDAD

const USUARIOS = { 1: { UsuarioID: 1, EstadoCuenta: 'Activo' }, 2: { UsuarioID: 2, EstadoCuenta: 'Activo' }, 3: { UsuarioID: 3, EstadoCuenta: 'Suspendido' } };
const dbUsuarios = { query: async (sql, [id]) => [[USUARIOS[id]].filter(Boolean)] };
let servidor, tiempoReal, URL_BASE;

before(async () => {
    servidor = http.createServer();
    tiempoReal = crearTiempoReal({ db: dbUsuarios, jwtSecreto: SECRETO });
    tiempoReal.conectar(servidor);
    await new Promise(listo => servidor.listen(0, listo));
    URL_BASE = `http://localhost:${servidor.address().port}`;
});
after(async () => {
    await tiempoReal.cerrar();
    servidor.close();
});

const conectar = (token) => new Promise((listo) => {
    const s = clienteIo(URL_BASE, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true, reconnection: false });
    s.on('connect', () => listo({ s, ok: true }));
    s.on('connect_error', (e) => listo({ s, ok: false, error: e.message }));
});
const esperar = (s, evento, ms = 1500) => new Promise((listo) => {
    const reloj = setTimeout(() => listo(null), ms);
    s.once(evento, (d) => { clearTimeout(reloj); listo(d); });
});
const token = (id, secreto = SECRETO) => jwt.sign({ id }, secreto);

test('Socket.IO: con token válido se conecta; con token falso o de cuenta suspendida, no', async () => {
    const bueno = await conectar(token(1));
    assert.ok(bueno.ok);
    const falso = await conectar(token(1, 'otro-secreto'));
    assert.deepEqual([falso.ok, falso.error], [false, 'sesion-invalida']);
    const suspendido = await conectar(token(3));
    assert.deepEqual([suspendido.ok, suspendido.error], [false, 'sesion-invalida']);
    const inexistente = await conectar(token(99));
    assert.equal(inexistente.ok, false);
    const anonimo = await conectar(null);
    assert.ok(anonimo.ok, 'sin token también se conecta (solo eventos públicos)');
    [bueno, falso, suspendido, inexistente, anonimo].forEach(c => c.s.close());
});

test('Socket.IO: aUsuario solo le llega a ese usuario; aTodos les llega a todos', async () => {
    const u1 = (await conectar(token(1))).s;
    const u2 = (await conectar(token(2))).s;
    const anonimo = (await conectar(null)).s;

    const privadoU1 = esperar(u1, 'notificacion:nueva');
    const privadoU2 = esperar(u2, 'notificacion:nueva', 400);
    const privadoAnonimo = esperar(anonimo, 'notificacion:nueva', 400);
    tiempoReal.aUsuario(1, 'notificacion:nueva', { id: 7 });
    assert.deepEqual(await privadoU1, { id: 7 });
    assert.equal(await privadoU2, null, 'otro usuario no recibe lo privado');
    assert.equal(await privadoAnonimo, null, 'una página sin sesión no recibe lo privado');

    const publicos = [u1, u2, anonimo].map(s => esperar(s, 'puja:nueva'));
    tiempoReal.aTodos('puja:nueva', { subastaId: 3, precioActual: 500, totalPujas: 2 });
    for (const p of await Promise.all(publicos)) assert.deepEqual(p, { subastaId: 3, precioActual: 500, totalPujas: 2 });
    assert.equal(tiempoReal.conectados(), 3);
    [u1, u2, anonimo].forEach(s => s.close());
});

test('Socket.IO: desconectarUsuario corta todas sus pestañas', async () => {
    const pestana1 = (await conectar(token(2))).s;
    const pestana2 = (await conectar(token(2))).s;
    const otro = (await conectar(token(1))).s;
    const cortes = [pestana1, pestana2].map(s => esperar(s, 'disconnect'));
    tiempoReal.desconectarUsuario(2);
    assert.deepEqual(await Promise.all(cortes), ['io server disconnect', 'io server disconnect']);
    assert.ok(otro.connected, 'los demás siguen conectados');
    otro.close();
});
