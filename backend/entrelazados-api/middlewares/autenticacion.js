// ==========================================================================
// SESIÓN Y PERMISOS
//
// El token JWT se entrega en /api/login y el navegador lo envía como
// "Authorization: Bearer <token>" (ver public/sesion.js). Al estar firmado con
// JWT_SECRET, el usuario no puede cambiar su ID ni su rol.
// Después se consulta la base de datos para tener el rol y el estado ACTUALES:
// si el admin suspende o elimina la cuenta, el token deja de servir al instante.
// ==========================================================================
const jwt = require('jsonwebtoken');

const esRolAdmin = (rol) => rol === 'administrador' || rol === 'admin';

function crearAutenticacion({ db, jwtSecreto, duracionSesion }) {
    const firmarToken = (usuario) =>
        jwt.sign({ id: usuario.UsuarioID, rol: usuario.TipoRol }, jwtSecreto, { expiresIn: duracionSesion });

    // Exige sesión. Deja en req.usuario = { id, rol, esAdmin }
    async function verificarToken(req, res, next) {
        const encabezado = req.headers['authorization'] || '';
        const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
        if (!token) {
            return res.status(401).json({ message: "Debes iniciar sesión para continuar." });
        }

        let usuarioId;
        try {
            usuarioId = jwt.verify(token, jwtSecreto).id;
        } catch (e) {
            return res.status(401).json({ message: "Tu sesión expiró o no es válida. Inicia sesión nuevamente." });
        }

        let usuario;
        try {
            [[usuario]] = await db.query('SELECT UsuarioID, TipoRol, EstadoCuenta FROM Usuarios WHERE UsuarioID = ?', [usuarioId]);
        } catch (err) {
            console.error('❌ Error al verificar la sesión:', err.message);
            return res.status(500).json({ message: "Error al verificar la sesión." });
        }
        if (!usuario) {
            return res.status(401).json({ message: "La cuenta ya no existe. Inicia sesión nuevamente." });
        }
        if ((usuario.EstadoCuenta || '').toLowerCase() === 'suspendido') {
            return res.status(403).json({ message: "Tu cuenta ha sido suspendida por el administrador." });
        }
        const rol = (usuario.TipoRol || '').toLowerCase();
        req.usuario = { id: usuario.UsuarioID, rol, esAdmin: esRolAdmin(rol) };
        next();
    }

    // Para usar después de verificarToken: limita la ruta a ciertos roles (el admin siempre pasa)
    const soloRoles = (...roles) => (req, res, next) => {
        if (req.usuario.esAdmin || roles.includes(req.usuario.rol)) return next();
        return res.status(403).json({ message: "Tu tipo de cuenta no tiene permiso para esta acción." });
    };

    // Sesión + rol administrador
    const verificarAdmin = [
        verificarToken,
        (req, res, next) => {
            if (!req.usuario.esAdmin) {
                return res.status(403).json({ message: "Acceso denegado. Se requieren permisos de Administrador." });
            }
            next();
        }
    ];

    return { firmarToken, verificarToken, soloRoles, verificarAdmin };
}

module.exports = { crearAutenticacion, esRolAdmin };
