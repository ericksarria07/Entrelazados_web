// Pruebas unitarias de utilidades.js (funciones puras: no necesitan base de datos ni servidor)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const u = require('../../entrelazados-api/utilidades');
const { respuestaFalsa, silenciarConsola } = require('./ayudas');

test('ErrorHttp guarda el código y los datos extra', () => {
    const err = new u.ErrorHttp(409, 'Ya tiene pujas', { pujas: 3 });
    assert.ok(err instanceof Error);
    assert.equal(err.status, 409);
    assert.equal(err.message, 'Ya tiene pujas');
    assert.deepEqual(err.extra, { pujas: 3 });
    assert.deepEqual(new u.ErrorHttp(400, 'x').extra, {});
});

test('REGEX_EMAIL acepta correos completos y rechaza los incompletos', () => {
    for (const bueno of ['erick@gmail.com', 'a.b+c@empresa.com.ni', 'x@y.io']) {
        assert.ok(u.REGEX_EMAIL.test(bueno), bueno);
    }
    for (const malo of ['erick@gmail', 'erick@gmail.c', 'sin-arroba.com', 'con espacio@a.com', '@a.com', '']) {
        assert.ok(!u.REGEX_EMAIL.test(malo), malo);
    }
});

test('esTokenValido exige 64 caracteres hexadecimales', () => {
    assert.ok(u.esTokenValido('a'.repeat(64)));
    assert.ok(u.esTokenValido('0123456789ABCDEF'.repeat(4)));
    assert.ok(!u.esTokenValido('a'.repeat(63)));
    assert.ok(!u.esTokenValido('g'.repeat(64)));
    assert.ok(!u.esTokenValido(undefined));
    assert.ok(!u.esTokenValido(['a'.repeat(64)]));   // ?token=a&token=b llega como lista
});

test('textoLimpio recorta los espacios y descarta lo que no es texto', () => {
    assert.equal(u.textoLimpio('  hola  '), 'hola');
    assert.equal(u.textoLimpio(42), '');
    assert.equal(u.textoLimpio(null), '');
    assert.equal(u.textoLimpio({ $ne: 1 }), '');
});

test('enteroPositivo solo acepta enteros mayores que 0', () => {
    assert.equal(u.enteroPositivo('7'), 7);
    assert.equal(u.enteroPositivo(3), 3);
    for (const malo of ['0', '-2', '1.5', 'abc', '', null, undefined]) {
        assert.equal(u.enteroPositivo(malo), null, String(malo));
    }
});

test('leerPaginacion: sin ?pagina devuelve null (lista completa)', () => {
    assert.equal(u.leerPaginacion({}), null);
});

test('leerPaginacion: calcula el desplazamiento y respeta el máximo', () => {
    assert.deepEqual(u.leerPaginacion({ pagina: '3', porPagina: '10' }), { pagina: 3, porPagina: 10, offset: 20 });
    assert.deepEqual(u.leerPaginacion({ pagina: '1' }, 12), { pagina: 1, porPagina: 12, offset: 0 });
    assert.equal(u.leerPaginacion({ pagina: '1', porPagina: '999' }, 12, 50).porPagina, 50);
    assert.equal(u.leerPaginacion({ pagina: '-4' }).pagina, 1);
    assert.equal(u.leerPaginacion({ pagina: 'abc' }).pagina, 1);
    assert.equal(u.leerPaginacion({ pagina: '1', porPagina: '0' }, 12).porPagina, 12);
});

test('respuestaPaginada calcula el total de páginas (mínimo 1)', () => {
    const p = { pagina: 2, porPagina: 10 };
    assert.deepEqual(u.respuestaPaginada(['a'], 25, p), { datos: ['a'], total: 25, pagina: 2, porPagina: 10, paginas: 3 });
    assert.equal(u.respuestaPaginada([], 0, p).paginas, 1);
});

test('patronLike toma literales los comodines que escribe el usuario', () => {
    assert.equal(u.patronLike('cuero'), '%cuero%');
    assert.equal(u.patronLike('  50%_off\\ '), '%50\\%\\_off\\\\%');
    assert.equal(u.patronLike('x'.repeat(300)).length, 102);   // máximo 100 caracteres + los dos %
});

test('ocultarCorreo deja ver solo la primera y la última letra', () => {
    assert.equal(u.ocultarCorreo('erick@gmail.com'), 'e***k@gmail.com');
    assert.equal(u.ocultarCorreo('ab@x.com'), 'a***@x.com');
    assert.equal(u.ocultarCorreo('sin-arroba'), '');
});

test('redondearCalificacion deja un decimal o null', () => {
    assert.equal(u.redondearCalificacion('4.6667'), 4.7);
    assert.equal(u.redondearCalificacion(5), 5);
    assert.equal(u.redondearCalificacion(null), null);
    assert.equal(u.redondearCalificacion(undefined), null);
});

test('conRespaldo responde el valor de respaldo si la consulta falla', async () => {
    const res = respuestaFalsa();
    await silenciarConsola(() =>
        u.conRespaldo([], async () => { throw new Error('la base no responde'); })({ method: 'GET', originalUrl: '/api/x' }, res));
    assert.equal(res.codigo, 500);
    assert.deepEqual(res.cuerpo, []);
});

test('conRespaldo no interviene si la ruta funciona', async () => {
    const res = respuestaFalsa();
    await u.conRespaldo([], async (req, r) => r.status(200).json(['ok']))({}, res);
    assert.equal(res.codigo, 200);
    assert.deepEqual(res.cuerpo, ['ok']);
});
