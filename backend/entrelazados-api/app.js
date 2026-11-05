// ==========================================================================
// LA APLICACIÓN EXPRESS
//
// Aquí solo se "conectan" las piezas, en este orden:
//   1. middlewares generales (CORS, JSON, límite de peticiones)
//   2. las rutas de la API, una por tema (carpeta rutas/)
//   3. los archivos estáticos (public/ y las fotos subidas)
//   4. la respuesta 404 de la API y el manejador de errores
// Lo que cada ruta necesita (base de datos, correo, servicios) se le pasa al
// crearla: así ninguna ruta depende de variables globales.
// ==========================================================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const limites = require('./middlewares/limites');
const fotos = require('./servicios/fotos');
const { crearAutenticacion } = require('./middlewares/autenticacion');
const { rutaNoEncontrada, manejadorErrores } = require('./middlewares/errores');
const { tiempoRealNulo } = require('./servicios/tiempoReal');
const { notificacionesNulas } = require('./servicios/notificaciones');
const { favoritosNulos } = require('./servicios/favoritos');
const { NO_DISPONIBLE } = require('./servicios/asistenteIA');
const { ErrorHttp } = require('./utilidades');

// Asistente de IA que siempre responde "no disponible" (pruebas sin base de datos)
const asistenteNulo = {
    configurado: false,
    describirPublicacion: async () => { throw new ErrorHttp(503, NO_DISPONIBLE); },
    sugerirPrecio: async () => { throw new ErrorHttp(503, NO_DISPONIBLE); }
};

function crearApp({ config, db, correo, servicios, verificarCorreo }) {
    const app = express();

    if (config.trustProxy) app.set('trust proxy', config.trustProxy);
    if (config.origenesCors.length > 0) app.use(cors({ origin: config.origenesCors }));
    // Las fotos viajan aparte como archivos (ver servicios/fotos.js)
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ limit: '1mb', extended: true }));
    // Documentación interactiva: /api/docs y /api/openapi.json (antes del límite de peticiones)
    app.use('/api', require('./rutas/documentacion')());
    app.use('/api', limites.api);

    const { firmarToken, verificarToken, soloRoles, verificarAdmin } = crearAutenticacion({
        db, jwtSecreto: config.jwtSecreto, duracionSesion: config.duracionSesion
    });
    // Dirección pública del sitio para los enlaces de los correos
    const urlPublica = (req) => config.urlPublica || `${req.protocol}://${req.get('host')}`;
    const { ofertas, tratos, cierreSubastas, kan } = servicios;
    // Tiempo real y notificaciones son opcionales (las pruebas sin base de datos no los usan)
    const tiempoReal = servicios.tiempoReal || tiempoRealNulo;
    const notificaciones = servicios.notificaciones || notificacionesNulas;
    const favoritos = servicios.favoritos || favoritosNulos;
    const asistenteIA = servicios.asistenteIA || asistenteNulo;

    // ------------------------------------------------------------ RUTAS
    app.use('/', require('./rutas/cuentas')({
        db, correo, firmarToken, rondasBcrypt: config.rondasBcrypt, verificarCorreo, urlPublica
    }));
    app.use('/api', require('./rutas/publicas')({ db }));
    app.use('/api/chat/ia', require('./rutas/kan')({ kan, verificarToken }));
    app.use('/api/chat', require('./rutas/chat')({ db, tiempoReal, verificarToken }));
    app.use('/api/ofertas', require('./rutas/ofertas')({ db, ofertas, favoritos, tiempoReal, verificarToken, soloRoles }));
    app.use('/api', require('./rutas/subastas')({ db, ofertas, tiempoReal, notificaciones, verificarToken, soloRoles }));
    app.use('/api/tratos', require('./rutas/tratos')({ db, tratos, verificarToken }));
    app.use('/api', require('./rutas/usuarios')({ db, tratos, verificarToken }));
    app.use('/api/dashboard', require('./rutas/dashboard')({ db, verificarToken }));
    app.use('/api/reportes', require('./rutas/reportes')({ db, verificarToken }));
    app.use('/api/notificaciones', require('./rutas/notificaciones')({ notificaciones, verificarToken }));
    app.use('/api', require('./rutas/favoritos')({ favoritos, verificarToken }));
    app.use('/api/mapa', require('./rutas/mapa')({ db, verificarToken }));
    app.use('/api/ia', require('./rutas/ia')({ asistenteIA, verificarToken, soloRoles }));
    app.use('/api/admin', require('./rutas/admin')({ db, ofertas, cierreSubastas, tiempoReal, verificarAdmin }));

    // ------------------------------------------------- ARCHIVOS ESTÁTICOS
    // Solo se publica la carpeta "public": así el código, el .env y los scripts
    // nunca se pueden descargar desde el navegador. La raíz "/" muestra preview.html.
    app.use(express.static(path.join(__dirname, 'public'), { index: 'preview.html' }));

    // Fotos subidas por los proveedores (fuera de public/ y fuera de git).
    // Los nombres son aleatorios y nunca cambian, así que el navegador puede guardarlas en caché.
    app.use('/uploads', express.static(fotos.CARPETA_UPLOADS, {
        index: false,
        dotfiles: 'deny',
        maxAge: '30d',
        immutable: true,
        setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
    }));

    // -------------------------------------------------------- ERRORES
    app.use('/api', rutaNoEncontrada);
    app.use(manejadorErrores);

    return app;
}

module.exports = { crearApp };
