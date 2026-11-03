// Pruebas unitarias de los middlewares: sesión y permisos, y manejo de errores.
// La base de datos se reemplaza por un objeto falso con la misma forma (db.query).
const { respuestaFalsa, silenciarConsola } = require('./ayudas');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { crearAutenticacion } = require('../../entrelazados-api/middlewares/autenticacion');
const { manejadorErrores, rutaNoEncontrada } = require('../../entrelazados-api/middlewares/errores');
const { ErrorHttp } = require('../../entrelazados-api/utilidades');

const SECRETO = 'secreto-de-pruebas-unitarias';

// Base de datos falsa: devuelve el usuario indicado (o falla si se pide)
function dbFalsa(usuario, { falla = false } = {}) {
    return {
        consultas: 0,
        async query() {
            this.consultas++;
            if (falla) throw new Error('la base no responde');
            return [usuario ? [usuario] : []];
        }
    };
}

// Ejecuta un middleware y dice si llamó a next() o qué respondió
async function correr(middleware, req) {
    const res = respuestaFalsa();
    let siguio = false;
    await middleware(req, res, () => { siguio = true; });
    return { siguio, codigo: res.codigo, cuerpo: res.cuerpo, req };
}

const conToken = (token) => ({ headers: { authorization: 'Bearer ' + token } });

test('verificarToken: sin token responde 401', async () => {
    const { verificarToken } = crearAutenticacion({ db: dbFalsa(null), jwtSecreto: SECRETO, duracionSesion: '1h' });
    const r = await correr(verificarToken, { headers: {} });
    assert.equal(r.siguio, false);
    assert.equal(r.codigo, 401);
});

test('verificarToken: un token firmado con otro secreto no sirve', async () => {
    const db = dbFalsa({ UsuarioID: 1, TipoRol: 'Administrador', EstadoCuenta: 'Activo' });
    const { verificarToken } = crearAutenticacion({ db, jwtSecreto: SECRETO, duracionSesion: '1h' });
    const r = await correr(verificarToken, conToken(jwt.sign({ id: 1, rol: 'Administrador' }, 'otro-secreto')));
    assert.equal(r.codigo, 401);
    assert.equal(db.consultas, 0, 'ni siquiera consulta la base');
});

test('verificarToken: un token vencido no sirve', async () => {
    const { verificarToken } = crearAutenticacion({ db: dbFalsa(null), jwtSecreto: SECRETO, duracionSesion: '1h' });
    const vencido = jwt.sign({ id: 1, exp: Math.floor(Date.now() / 1000) - 60 }, SECRETO);
    assert.equal((await correr(verificarToken, conToken(vencido))).codigo, 401);
});

test('verificarToken: token válido deja el rol ACTUAL de la base en req.usuario', async () => {
    // El token dice Emprendedor, pero en la base ya es Administrador: manda la base
    const db = dbFalsa({ UsuarioID: 7, TipoRol: 'Administrador', EstadoCuenta: 'Activo' });
    const auth = crearAutenticacion({ db, jwtSecreto: SECRETO, duracionSesion: '1h' });
    const token = jwt.sign({ id: 7, rol: 'Emprendedor' }, SECRETO);
    const r = await correr(auth.verificarToken, conToken(token));
    assert.equal(r.siguio, true);
    assert.deepEqual(r.req.usuario, { id: 7, rol: 'administrador', esAdmin: true });
});

test('verificarToken: cuenta suspendida → 403 y cuenta borrada → 401', async () => {
    const token = jwt.sign({ id: 7 }, SECRETO);
    const suspendida = crearAutenticacion({ db: dbFalsa({ UsuarioID: 7, TipoRol: 'Proveedor', EstadoCuenta: 'Suspendido' }), jwtSecreto: SECRETO });
    assert.equal((await correr(suspendida.verificarToken, conToken(token))).codigo, 403);
    const borrada = crearAutenticacion({ db: dbFalsa(null), jwtSecreto: SECRETO });
    assert.equal((await correr(borrada.verificarToken, conToken(token))).codigo, 401);
});

test('verificarToken: si la base falla responde 500 (no deja pasar)', async () => {
    const { verificarToken } = crearAutenticacion({ db: dbFalsa(null, { falla: true }), jwtSecreto: SECRETO });
    const r = await silenciarConsola(() => correr(verificarToken, conToken(jwt.sign({ id: 1 }, SECRETO))));
    assert.equal(r.siguio, false);
    assert.equal(r.codigo, 500);
});

test('firmarToken guarda el ID y el rol, y dura lo indicado', () => {
    const { firmarToken } = crearAutenticacion({ db: dbFalsa(null), jwtSecreto: SECRETO, duracionSesion: '8h' });
    const datos = jwt.verify(firmarToken({ UsuarioID: 5, TipoRol: 'Proveedor' }), SECRETO);
    assert.equal(datos.id, 5);
    assert.equal(datos.rol, 'Proveedor');
    assert.equal(datos.exp - datos.iat, 8 * 3600);
});

test('soloRoles deja pasar a los roles indicados y siempre al admin', async () => {
    const { soloRoles } = crearAutenticacion({ db: dbFalsa(null), jwtSecreto: SECRETO });
    const soloProveedor = soloRoles('proveedor');
    assert.equal((await correr(soloProveedor, { usuario: { rol: 'proveedor', esAdmin: false } })).siguio, true);
    assert.equal((await correr(soloProveedor, { usuario: { rol: 'administrador', esAdmin: true } })).siguio, true);
    const r = await correr(soloProveedor, { usuario: { rol: 'emprendedor', esAdmin: false } });
    assert.equal(r.siguio, false);
    assert.equal(r.codigo, 403);
});

test('verificarAdmin rechaza con 403 a quien no es administrador', async () => {
    const db = dbFalsa({ UsuarioID: 3, TipoRol: 'Proveedor', EstadoCuenta: 'Activo' });
    const { verificarAdmin } = crearAutenticacion({ db, jwtSecreto: SECRETO });
    const req = conToken(jwt.sign({ id: 3 }, SECRETO));
    const paso1 = await correr(verificarAdmin[0], req);
    assert.equal(paso1.siguio, true);
    const paso2 = await correr(verificarAdmin[1], req);
    assert.equal(paso2.siguio, false);
    assert.equal(paso2.codigo, 403);
});

test('manejadorErrores responde un ErrorHttp con su código, mensaje y datos extra', () => {
    const res = respuestaFalsa();
    manejadorErrores(new ErrorHttp(409, 'Ya tiene pujas', { pujas: 2 }), {}, res, () => { });
    assert.equal(res.codigo, 409);
    assert.deepEqual(res.cuerpo, { message: 'Ya tiene pujas', pujas: 2 });
});

test('manejadorErrores: JSON mal escrito → 400 y datos demasiado grandes → 413', () => {
    const r1 = respuestaFalsa();
    manejadorErrores(Object.assign(new Error('x'), { type: 'entity.parse.failed' }), {}, r1, () => { });
    assert.equal(r1.codigo, 400);
    const r2 = respuestaFalsa();
    manejadorErrores(Object.assign(new Error('x'), { type: 'entity.too.large' }), {}, r2, () => { });
    assert.equal(r2.codigo, 413);
});

test('manejadorErrores no revela el detalle de un error inesperado', async () => {
    const res = respuestaFalsa();
    await silenciarConsola(() => manejadorErrores(
        new Error("ER_NO_SUCH_TABLE: Table 'entrelazadosdb.usuarios' doesn't exist"),
        { method: 'GET', originalUrl: '/api/x' }, res, () => { }));
    assert.equal(res.codigo, 500);
    assert.deepEqual(res.cuerpo, { message: 'Error interno del servidor.' });
});

test('rutaNoEncontrada responde 404 en JSON', () => {
    const res = respuestaFalsa();
    rutaNoEncontrada({}, res);
    assert.equal(res.codigo, 404);
    assert.equal(res.cuerpo.message, 'Ruta no encontrada.');
});
