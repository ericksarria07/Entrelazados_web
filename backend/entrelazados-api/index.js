// ==========================================================================
// ENTRELAZADOS: PUNTO DE ARRANQUE DEL SERVIDOR
//
// Crea las piezas compartidas (base de datos, correo, servicios), arma la
// aplicación (app.js) y empieza a escuchar. Se inicia con:
//   node index.js        (o npm start desde backend/; en la VM lo hace PM2)
//
// Mapa del código:
//   config.js         variables del .env, revisadas
//   db.js             conexión a MySQL y transacciones
//   app.js            Express: middlewares, rutas, archivos estáticos, errores
//   middlewares/      sesión y permisos, límites de intentos, errores
//   rutas/            una por tema: cuentas, ofertas, subastas, chat, tratos, admin...
//   servicios/        lógica que no depende de HTTP: correo, fotos, cierre de
//                     subastas, tratos, ofertas, Kan
//   utilidades.js     paginación, validaciones y el error ErrorHttp
//   public/           las páginas que ve el navegador
// ==========================================================================
const config = require('./config');
const { crearPool } = require('./db');
const { crearApp } = require('./app');
const { crearServicioCorreo } = require('./servicios/correo');
const { crearCierreSubastas } = require('./servicios/subastas');
const { crearServicioTratos } = require('./servicios/tratos');
const { crearServicioOfertas } = require('./servicios/ofertas');
const { crearKan } = require('./servicios/kan');

// Un error inesperado se registra en el log, pero no tumba el servidor
process.on('uncaughtException', (err) => console.error('❌ Excepción no capturada:', err.stack || err.message));
process.on('unhandledRejection', (motivo) => console.error('❌ Promesa rechazada no manejada:', motivo));

// BASE DE DATOS
const db = crearPool(config.db);
console.log('✅ Pool de conexiones MySQL inicializado correctamente.');

// CORREO. Opcional: si EMAIL_USER / EMAIL_PASS no están en el .env, los enlaces se escriben en el log.
const correo = crearServicioCorreo();
if (!correo.configurado) {
    console.warn('⚠️ EMAIL_USER / EMAIL_PASS no están en el .env: los enlaces de recuperación solo se mostrarán en el log.');
} else {
    correo.verificar().then(({ ok, motivo }) => {
        if (ok) console.log(`✅ Correo listo: los enlaces de recuperación se envían desde ${correo.remitente}.`);
        else console.error(`❌ El correo de recuperación NO funciona: ${motivo}`);
    });
}

// CONFIRMAR EL CORREO AL REGISTRARSE: VERIFICAR_CORREO=1 siempre, 0 nunca. Si no se indica,
// se exige solo cuando el correo está configurado (sin correo nadie recibiría el enlace).
// Las cuentas que ya existían quedan verificadas (ver sql/migracion_v10.sql).
const verificarCorreo = config.modoVerificacionCorreo === '1'
    || (config.modoVerificacionCorreo !== '0' && correo.configurado);
console.log(verificarCorreo
    ? '✅ Las cuentas nuevas deben confirmar su correo antes de iniciar sesión.'
    : '⚠️ Verificación de correo desactivada: las cuentas nuevas entran sin confirmar su correo.');

// SERVICIOS
const urlBase = config.urlPublica || null;
const cierreSubastas = crearCierreSubastas({ db, correo, urlBase });
const servicios = {
    cierreSubastas,
    tratos: crearServicioTratos({ db, correo, urlBase }),
    ofertas: crearServicioOfertas({ db, cierreSubastas }),
    kan: crearKan({ db, clave: config.gemini.clave, modelo: config.gemini.modelo })
};

// APLICACIÓN
const app = crearApp({ config, db, correo, servicios, verificarCorreo });
cierreSubastas.iniciar(config.intervaloCierreSubastasSeg);
app.listen(config.puerto, () => {
    console.log(`📡 Servidor Backend ejecutándose en el puerto ${config.puerto}`);
});
