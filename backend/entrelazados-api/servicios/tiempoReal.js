// ==========================================================================
// TIEMPO REAL (Socket.IO)
//
// Mantiene abierta una conexión con cada página para que el servidor pueda
// AVISAR al instante, sin que la página tenga que preguntar cada pocos segundos.
//
//   Evento               A quién                   Datos
//   puja:nueva           a todos                   { subastaId, precioActual, totalPujas }
//   subastas:cambio      a todos                   { subastaId?, motivo }  (nueva, editada, cancelada, cerrada)
//   chat:mensaje         al remitente y al destino { remitenteId, destinatarioId }
//   notificacion:nueva   al usuario                la notificación (ver servicios/notificaciones.js)
//
// Al conectarse, la página envía su token (el mismo de /api): así el servidor
// sabe quién es y lo mete en su "sala" privada (usuario:<id>). Sin token también
// se puede conectar, pero solo recibe los eventos públicos (las pujas).
// Los eventos solo dicen QUÉ cambió; los datos completos se piden a la API de
// siempre, que es la que revisa los permisos.
//
// En el navegador, public/sesion.js se conecta y reenvía cada evento como
// "entrelazados:<evento>" (por ejemplo entrelazados:puja:nueva).
// ==========================================================================
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const sala = (usuarioId) => `usuario:${usuarioId}`;

function crearTiempoReal({ db, jwtSecreto }) {
    let io = null;

    // Se engancha al servidor HTTP (lo crea index.js), en la misma dirección y puerto
    // que la página: /socket.io/...
    function conectar(servidorHttp) {
        io = new Server(servidorHttp, {
            serveClient: true,          // el navegador descarga /socket.io/socket.io.min.js
            pingInterval: 25000,
            pingTimeout: 20000
        });

        // Quién se conecta: se revisa el token y que la cuenta siga activa
        io.use(async (socket, next) => {
            const token = socket.handshake.auth && socket.handshake.auth.token;
            if (!token) return next();
            try {
                const { id } = jwt.verify(token, jwtSecreto);
                const [[usuario]] = await db.query('SELECT UsuarioID, EstadoCuenta FROM Usuarios WHERE UsuarioID = ?', [id]);
                if (!usuario || String(usuario.EstadoCuenta).toLowerCase() === 'suspendido') {
                    return next(new Error('sesion-invalida'));
                }
                socket.data.usuarioId = usuario.UsuarioID;
                next();
            } catch (err) {
                next(new Error('sesion-invalida'));
            }
        });

        io.on('connection', (socket) => {
            if (socket.data.usuarioId) socket.join(sala(socket.data.usuarioId));
        });
        return io;
    }

    // Avisa a uno o varios usuarios (en todas sus pestañas abiertas)
    function aUsuario(usuarioIds, evento, datos = {}) {
        if (!io) return;
        for (const id of [].concat(usuarioIds)) {
            if (id) io.to(sala(id)).emit(evento, datos);
        }
    }

    // Avisa a todas las páginas conectadas (solo datos públicos)
    function aTodos(evento, datos = {}) {
        if (io) io.emit(evento, datos);
    }

    // Corta las conexiones de un usuario (cuenta suspendida o eliminada)
    function desconectarUsuario(usuarioId) {
        if (io) io.in(sala(usuarioId)).disconnectSockets(true);
    }

    const conectados = () => (io ? io.engine.clientsCount : 0);

    function cerrar() {
        return new Promise((listo) => (io ? io.close(() => listo()) : listo()));
    }

    return { conectar, aUsuario, aTodos, desconectarUsuario, conectados, cerrar };
}

// Versión que no hace nada: para pruebas o scripts que no levantan el servidor
const tiempoRealNulo = {
    conectar() { }, aUsuario() { }, aTodos() { }, desconectarUsuario() { },
    conectados: () => 0, cerrar: async () => { }
};

module.exports = { crearTiempoReal, tiempoRealNulo };
