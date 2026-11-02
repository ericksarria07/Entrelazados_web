require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { GoogleGenAI } = require('@google/genai');

// VARIABLES DE ENTORNO OBLIGATORIAS (definidas en .env, ver .env.example)
const VARIABLES_REQUERIDAS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET'];
const faltantes = VARIABLES_REQUERIDAS.filter(v => !process.env[v]);
if (faltantes.length > 0) {
    console.error(`❌ Faltan variables en el archivo .env: ${faltantes.join(', ')}`);
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_RONDAS = 10;

const app = express();

// CONFIGURACIÓN DE CORS
app.use(cors());

// PARSEO DE PETICIONES JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// INICIALIZACIÓN SEGURA DE GEMINI API
let ai = null;
try {
    const apiKey = process.env.GEMINI_API_KEY || 'CLAVE_TEMPORAL';
    ai = new GoogleGenAI({ apiKey });
} catch (err) {
    console.error('⚠️ No se pudo inicializar GoogleGenAI:', err.message);
}

// MANEJO GLOBAL DE EXCEPCIONES PARA EVITAR CRASH DEL PROCESO EN IIS
process.on('uncaughtException', (err) => {
    console.error('❌ Excepción no capturada:', err.stack || err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// CONFIGURACIÓN DE BASE DE DATOS USANDO POOL ROBUSTO
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

db.on('error', (err) => {
    console.error('⚠️ Error en el pool de MySQL:', err.message);
});

console.log('✅ Pool de conexiones MySQL inicializado correctamente.');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'tu_correo@gmail.com',
        pass: 'tu_contrasena_de_aplicacion'
    }
});

/* ==========================================================================
   MIDDLEWARE DE VERIFICACIÓN DE ROL ADMINISTRADOR
   ========================================================================== */
// El token JWT se entrega en /api/login y el navegador lo envía como
// "Authorization: Bearer <token>". Al estar firmado con JWT_SECRET,
// el usuario no puede falsificar su ID ni su rol.
// Después se consulta la BD para tener el rol y estado actuales
// (si el admin suspende o elimina la cuenta, el token deja de servir al instante).
const verificarToken = (req, res, next) => {
    const encabezado = req.headers['authorization'] || '';
    const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;

    if (!token) {
        return res.status(401).json({ message: "Debes iniciar sesión para continuar." });
    }

    let usuarioId;
    try {
        usuarioId = jwt.verify(token, JWT_SECRET).id;
    } catch (e) {
        return res.status(401).json({ message: "Tu sesión expiró o no es válida. Inicia sesión nuevamente." });
    }

    db.query('SELECT UsuarioID, TipoRol, EstadoCuenta FROM Usuarios WHERE UsuarioID = ?', [usuarioId], (err, results) => {
        if (err) {
            return res.status(500).json({ message: "Error al verificar la sesión." });
        }
        if (!results || results.length === 0) {
            return res.status(401).json({ message: "La cuenta ya no existe. Inicia sesión nuevamente." });
        }
        const usuario = results[0];
        if ((usuario.EstadoCuenta || '').toLowerCase() === 'suspendido') {
            return res.status(403).json({ message: "Tu cuenta ha sido suspendida por el administrador." });
        }
        const rol = (usuario.TipoRol || '').toLowerCase();
        req.usuario = {
            id: usuario.UsuarioID,
            rol,
            esAdmin: rol === 'administrador' || rol === 'admin'
        };
        next();
    });
};

// Para usar después de verificarToken: limita la ruta a ciertos roles (el admin siempre pasa)
const soloRoles = (...roles) => (req, res, next) => {
    if (req.usuario.esAdmin || roles.includes(req.usuario.rol)) return next();
    return res.status(403).json({ message: "Tu tipo de cuenta no tiene permiso para esta acción." });
};

const verificarAdmin = [
    verificarToken,
    (req, res, next) => {
        if (!req.usuario.esAdmin) {
            return res.status(403).json({ message: "Acceso denegado. Se requieren permisos de Administrador." });
        }
        next();
    }
];

// RUTA DE PRUEBA DE SALUD DE LA API
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', message: 'API operando en SmarterASP.NET' });
});

/* ==========================================================================
   ENDPOINT PARA LA IA DE KAN (RANDAL) - CON SOPORTE ADMIN
   ========================================================================== */
app.post('/api/chat/ia', (req, res) => {
    const { mensajeUsuario, rolUsuario } = req.body;

    if (typeof mensajeUsuario !== 'string' || !mensajeUsuario.trim()) {
        return res.status(400).json({ error: "El mensaje del usuario es obligatorio." });
    }
    if (mensajeUsuario.length > 1000) {
        return res.status(400).json({ error: "El mensaje es demasiado largo (máximo 1000 caracteres)." });
    }

    const textoLimpio = mensajeUsuario.toLowerCase().trim();
    const rolNormalizado = (rolUsuario || 'emprendedor').toLowerCase().trim();

    // RESPUESTAS PARA ADMINISTRADORES
    if (rolNormalizado === 'administrador' || rolNormalizado === 'admin') {
        if (textoLimpio.includes('reporte') || textoLimpio.includes('usuarios de hoy') || textoLimpio.includes('métricas')) {
            return res.json({
                respuesta: "Puedes consultar las estadísticas globales y la lista completa de usuarios registrados ingresando a tu Panel de Administración (`admin.html`)."
            });
        }
        if (textoLimpio.includes('modero') || textoLimpio.includes('elimino') || textoLimpio.includes('lote') || textoLimpio.includes('publicación')) {
            return res.json({
                respuesta: "Como administrador, puedes suspender usuarios o eliminar publicaciones inapropiadas/agotadas directamente desde la sección de Moderación en el panel administrativo."
            });
        }
    }

    // RESPUESTAS INSTANTÁNEAS GENERALES
    if (textoLimpio === 'hola' || textoLimpio === 'buenas' || textoLimpio === 'saludos' || textoLimpio.startsWith('hola ')) {
        return res.json({
            respuesta: "¡Hola! 🤝 Soy Kan, tu guía en EntreLazados. ¿En qué te puedo ayudar hoy con la materia prima para calzado o marroquinería?"
        });
    }

    if (textoLimpio.includes('generan las subastas') || textoLimpio.includes('publicar un insumo')) {
        return res.json({
            respuesta: "Cada vez que publicas un nuevo material desde tu formulario en el dashboard, el sistema de EntreLazados crea automáticamente un lote en la sección de Subastas utilizando el precio base que estableciste, dándole una vigencia de 7 días para que los emprendedores puedan pujar."
        });
    }

    if (textoLimpio.includes('edito o elimino') || textoLimpio.includes('material que ya se agotó')) {
        return res.json({
            respuesta: "Puedes gestionar tus publicaciones ingresando al Mercado o revisando tus ofertas activas. Al presionar el botón de eliminar en tu lote, el sistema retirará inmediatamente el material de la vista pública de los talleres."
        });
    }

    if (textoLimpio.includes('talleres están interesados') || textoLimpio.includes('materia prima')) {
        return res.json({
            respuesta: "Puedes revisar el apartado de Chat en la barra de navegación superior. Ahí recibirás de forma directa los mensajes y consultas de los emprendedores que han visto tus ofertas de cuero, suelas o herrajes."
        });
    }

    if (textoLimpio.includes('contactan los compradores') || textoLimpio.includes('compradores')) {
        return res.json({
            respuesta: "Los compradores y talleres se comunicarán contigo directamente mediante el sistema de chat interno de la plataforma o a través de los datos de contacto corporativos que registraste."
        });
    }

    if (textoLimpio.includes('cómo busco materia prima') || textoLimpio.includes('buscar materia prima')) {
        return res.json({
            respuesta: "Para buscar materia prima, ve a la pestaña **'Mercado'** en la plataforma. Ahí encontrarás categorías como cuero, suelas, herrajes e hilos publicadas por proveedores nicaragüenses verificados, ordenadas por precio y cercanía."
        });
    }

    if (textoLimpio.includes('cómo me contacto con proveedores') || textoLimpio.includes('pedido especial') || textoLimpio.includes('contactar proveedores')) {
        return res.json({
            respuesta: "En el perfil de cualquier oferta publicada encontrarás acceso directo al Chat de la plataforma o el número de WhatsApp corporativo registrado por el proveedor para coordinar entregas personalizadas."
        });
    }

    if (textoLimpio.includes('insumos cerca') || textoLimpio.includes('radio de envíos') || textoLimpio.includes('distancia')) {
        return res.json({
            respuesta: "EntreLazados toma tu departamento registrado y calcula una distancia simulada en kilómetros respecto a la ubicación del proveedor. Puedes ajustar el control deslizante de 'Radio de Cercanía' en la barra superior para encontrar proveedores más próximos."
        });
    }

    if (textoLimpio.includes('funcionan las pujas') || textoLimpio.includes('pujas en las subastas')) {
        return res.json({
            respuesta: "En la sección de Subastas verás los lotes activos publicados por los proveedores. Puedes ingresar una oferta económica superior a la puja actual en córdobas (C$) para competir por el lote y adquirir insumos a un precio más competitivo."
        });
    }

    // CONSULTAS CONECTADAS A BASE DE DATOS E IA
    const queryOfertas = `
        SELECT o.TituloMaterial, o.Precio, o.UnidadMedida, c.NombreCategoria 
        FROM Ofertas o
        JOIN CategoriasMateriales c ON o.CategoriaID = c.CategoriaID
        LIMIT 10
    `;

    const querySubastas = `
        SELECT TituloLote, PrecioActual, FechaFin 
        FROM Subastas 
        WHERE Estado = 'Activa' 
        LIMIT 5
    `;

    db.query(queryOfertas, (errOfertas, resultadosOfertas) => {
        const ofertasLote = errOfertas || !resultadosOfertas ? [] : resultadosOfertas;

        db.query(querySubastas, async (errSubastas, resultadosSubastas) => {
            const subastasLote = errSubastas || !resultadosSubastas ? [] : resultadosSubastas;

            const listaOfertasTexto = ofertasLote.length > 0
                ? ofertasLote.map(o => `- ${o.TituloMaterial} (${o.NombreCategoria}): C$${o.Precio} por ${o.UnidadMedida}`).join('\n')
                : 'No hay ofertas registradas en este momento.';

            const listaSubastasTexto = subastasLote.length > 0
                ? subastasLote.map(s => `- ${s.TituloLote}: Puja actual C$${s.PrecioActual}`).join('\n')
                : 'No hay subastas activas actualmente.';

            const systemInstruction = `
Eres Kan (también conocido como Randal), el asistente virtual oficial de "EntreLazados" en Nicaragua.
EntreLazados conecta a proveedores de materia prima con emprendedores del sector calzado y marroquinería.

REGLAS DE RESPUESTA:
1. Responde de forma amable, cercana y profesional con modismos amigables del comercio nicaragüense.
2. Si el usuario pregunta por inventario, precios o materiales en venta, utiliza ÚNICAMENTE esta información real:
=== INVENTARIO Y OFERTAS ACTUALES ===
${listaOfertasTexto}

=== SUBASTAS ACTIVAS ===
${listaSubastasTexto}

3. Adapta tu respuesta según el rol: ${rolNormalizado}.
4. Respuestas concisas (máximo 3 párrafos).
`;

            try {
                if (!ai) throw new Error("Cliente de IA no configurado");

                const response = await ai.models.generateContent({
                    model: 'gemini-3.8-flash',
                    contents: mensajeUsuario,
                    config: {
                        systemInstruction: systemInstruction,
                        temperature: 0.6,
                        maxOutputTokens: 600
                    }
                });

                const respuestaIA = response.text || "Lo siento, no pude procesar tu solicitud.";
                res.json({ respuesta: respuestaIA });

            } catch (error) {
                console.error("❌ Error en la API de Gemini:", error.message || error);
                res.json({
                    respuesta: "¡Hola! Estoy experimentando problemas temporales al consultar los servidores de IA, pero recuerda que en EntreLazados puedes explorar las pestañas de Mercado y Subastas para gestionar tus insumos con total normalidad."
                });
            }
        });
    });
});

// RUTA PARA REGISTRAR USUARIOS
app.post('/registro', (req, res) => {
    const {
        nombre,
        email,
        telefono,
        rol,
        deptoId,
        password,
        contrasena,
        numeroRuc,
        nombreComercial,
        tipoMateriaPrimaPrincipal,
        descripcionEmpresa,
        nombreMarca,
        especialidadCalzado,
        capacidadProduccionMensual,
        nivelAcceso
    } = req.body;

    const nombreDepartamento = typeof deptoId === 'string' ? deptoId.trim() : '';
    const passwordPlano = password || contrasena;
    const emailLimpio = typeof email === 'string' ? email.trim() : '';

    if (!nombreDepartamento || !emailLimpio || !nombre || !rol || !passwordPlano) {
        return res.status(400).json({ message: "Por favor, completa todos los campos obligatorios." });
    }

    if (typeof passwordPlano !== 'string' || passwordPlano.length < 6) {
        return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres." });
    }

    // Solo se permite registrarse como Proveedor o Emprendedor (nunca como administrador)
    if (!['proveedor', 'emprendedor'].includes(String(rol).toLowerCase())) {
        return res.status(400).json({ message: "Rol no válido." });
    }

    // La contraseña se guarda cifrada con bcrypt, nunca en texto plano
    const passwordHash = bcrypt.hashSync(passwordPlano, BCRYPT_RONDAS);

    if (!REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({
            message: "El correo electrónico no es válido. Debe incluir el dominio completo (ejemplo: usuario@gmail.com)."
        });
    }

    const sqlBuscarDepto = `SELECT DepartamentoID FROM Departamentos WHERE NombreDepartamento = ?`;

    db.query(sqlBuscarDepto, [nombreDepartamento], (err, deptoResult) => {
        if (err) {
            return res.status(500).json({ message: "Error interno del servidor al verificar departamento." });
        }

        const procesarRegistro = (idDepartamento) => {
            db.getConnection((errConn, connection) => {
                if (errConn) {
                    return res.status(500).json({ message: "Error al obtener conexión de la base de datos." });
                }

                connection.beginTransaction((errTx) => {
                    if (errTx) {
                        connection.release();
                        return res.status(500).json({ message: "Error al iniciar la transacción." });
                    }

                    const sqlUsuario = `
                        INSERT INTO Usuarios (CorreoElectronico, ContrasenaHash, TipoRol, EstadoCuenta) 
                        VALUES (?, ?, ?, 'Activo')
                    `;

                    connection.query(sqlUsuario, [emailLimpio, passwordHash, rol], (errUser, resultUser) => {
                        if (errUser) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ message: "El correo ya está registrado o hubo un error." });
                            });
                        }

                        const nuevoUsuarioId = resultUser.insertId;

                        const sqlPerfil = `
                            INSERT INTO PerfilesUsuarios (UsuarioID, NombreRazonSocial, TelefonoWhatsApp, DepartamentoID) 
                            VALUES (?, ?, ?, ?)
                        `;

                        connection.query(sqlPerfil, [nuevoUsuarioId, nombre, telefono || '', idDepartamento], (errPerfil) => {
                            if (errPerfil) {
                                return connection.rollback(() => {
                                    connection.release();
                                    res.status(500).json({ message: "Error al guardar el perfil del usuario." });
                                });
                            }

                            let sqlRol = '';
                            let paramsRol = [];

                            const rolMinus = rol.toLowerCase();

                            if (rolMinus === 'proveedor') {
                                sqlRol = `
                                    INSERT INTO Proveedores (UsuarioID, NumeroRUC, NombreComercial, TipoMateriaPrimaPrincipal, DescripcionEmpresa) 
                                    VALUES (?, ?, ?, ?, ?)
                                `;
                                paramsRol = [
                                    nuevoUsuarioId,
                                    numeroRuc || null,
                                    nombreComercial || nombre,
                                    tipoMateriaPrimaPrincipal || null,
                                    descripcionEmpresa || null
                                ];
                            } else if (rolMinus === 'administrador' || rolMinus === 'admin') {
                                sqlRol = `
                                    INSERT INTO Administradores (UsuarioID, NivelAcceso) 
                                    VALUES (?, ?)
                                `;
                                paramsRol = [
                                    nuevoUsuarioId,
                                    nivelAcceso || 'SuperAdmin'
                                ];
                            } else {
                                sqlRol = `
                                    INSERT INTO Emprendedores (UsuarioID, NombreMarca, EspecialidadCalzado, CapacidadProduccionMensual) 
                                    VALUES (?, ?, ?, ?)
                                `;
                                paramsRol = [
                                    nuevoUsuarioId,
                                    nombreMarca || nombre,
                                    especialidadCalzado || null,
                                    capacidadProduccionMensual ? parseInt(capacidadProduccionMensual, 10) : null
                                ];
                            }

                            connection.query(sqlRol, paramsRol, (errRol) => {
                                if (errRol) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        res.status(500).json({ message: "Error al configurar datos del rol." });
                                    });
                                }

                                connection.commit((errCommit) => {
                                    if (errCommit) {
                                        return connection.rollback(() => {
                                            connection.release();
                                            res.status(500).json({ message: "Error al confirmar el registro." });
                                        });
                                    }
                                    connection.release();
                                    res.json({ message: "¡Registro exitoso en la plataforma!" });
                                });
                            });
                        });
                    });
                });
            });
        };

        if (deptoResult && deptoResult.length > 0) {
            procesarRegistro(deptoResult[0].DepartamentoID);
        } else {
            const sqlInsertarDepto = `INSERT INTO Departamentos (NombreDepartamento) VALUES (?)`;
            db.query(sqlInsertarDepto, [nombreDepartamento], (errIns, insertResult) => {
                if (errIns) {
                    return res.status(500).json({ message: "Error al registrar el departamento." });
                }
                procesarRegistro(insertResult.insertId);
            });
        }
    });
});

// RUTA DE LOGIN (INCLUYE SOPORTE PARA ESTADO Y ROL ADMIN)
app.post('/api/login', (req, res) => {
    const { email, password, contrasena } = req.body;
    const emailLimpio = email ? email.trim() : '';
    const passIngresada = password || contrasena;

    if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({ message: "Ingresa un correo electrónico válido." });
    }

    if (!passIngresada) {
        return res.status(400).json({ message: "Ingresa tu contraseña." });
    }

    const sqlBuscarUsuario = `
        SELECT u.UsuarioID, u.ContrasenaHash, u.TipoRol, u.EstadoCuenta, p.NombreRazonSocial, d.NombreDepartamento
        FROM Usuarios u
        LEFT JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
        LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
        WHERE u.CorreoElectronico = ?
    `;

    db.query(sqlBuscarUsuario, [emailLimpio], (err, results) => {
        if (err) {
            console.error('❌ Error en Login MySQL:', err.message);
            return res.status(500).json({ message: "Error al consultar la base de datos." });
        }

        if (!results || results.length === 0) {
            return res.status(401).json({ message: "Correo o contraseña incorrectos." });
        }

        const usuario = results[0];
        const hashGuardado = usuario.ContrasenaHash || '';
        const esHashBcrypt = /^\$2[aby]\$/.test(hashGuardado);

        // Compatibilidad: las cuentas antiguas tienen la contraseña en texto plano.
        // Si coincide, se cifra con bcrypt en ese momento (migración automática).
        const coincide = esHashBcrypt
            ? bcrypt.compareSync(String(passIngresada), hashGuardado)
            : hashGuardado === String(passIngresada);

        if (!coincide) {
            return res.status(401).json({ message: "Correo o contraseña incorrectos." });
        }

        if (usuario.EstadoCuenta && usuario.EstadoCuenta.toLowerCase() === 'suspendido') {
            return res.status(403).json({ message: "Tu cuenta ha sido suspendida por el administrador." });
        }

        if (!esHashBcrypt) {
            const nuevoHash = bcrypt.hashSync(String(passIngresada), BCRYPT_RONDAS);
            db.query('UPDATE Usuarios SET ContrasenaHash = ? WHERE UsuarioID = ?', [nuevoHash, usuario.UsuarioID], (errHash) => {
                if (errHash) console.error('⚠️ No se pudo migrar la contraseña a bcrypt:', errHash.message);
            });
        }

        const token = jwt.sign({ id: usuario.UsuarioID, rol: usuario.TipoRol }, JWT_SECRET, { expiresIn: '8h' });

        return res.json({
            id: usuario.UsuarioID,
            nombre: usuario.NombreRazonSocial || 'Usuario',
            rol: usuario.TipoRol,
            departamento: usuario.NombreDepartamento || 'Managua',
            estado: usuario.EstadoCuenta || 'Activo',
            token
        });
    });
});

// RUTA DE RECUPERACIÓN DE CONTRASEÑA
app.post('/api/solicitar-recuperacion', (req, res) => {
    const { email } = req.body;
    const emailLimpio = email ? email.trim() : '';

    if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({ message: "Por favor proporciona un correo electrónico válido." });
    }

    const sqlBuscar = `SELECT UsuarioID FROM Usuarios WHERE CorreoElectronico = ?`;

    db.query(sqlBuscar, [emailLimpio], (err, results) => {
        if (err || !results || results.length === 0) {
            return res.json({ message: "Si el correo está registrado, recibirás un enlace de recuperación." });
        }

        const usuarioId = results[0].UsuarioID;
        const token = crypto.randomBytes(32).toString('hex');
        const expiracion = new Date(Date.now() + 3600000);

        const sqlGuardarToken = `
            UPDATE Usuarios 
            SET TokenRecuperacion = ?, ExpiracionToken = ? 
            WHERE UsuarioID = ?
        `;

        db.query(sqlGuardarToken, [token, expiracion, usuarioId], (errToken) => {
            if (errToken) {
                return res.status(500).json({ message: "Error interno al generar enlace." });
            }

            const hostActual = req.get('host');
            const enlace = `${req.protocol}://${hostActual}/restablecer.html?token=${token}`;

            const mailOptions = {
                from: '"EntreLazados" <tu_correo@gmail.com>',
                to: emailLimpio,
                subject: 'Recuperación de Contraseña - EntreLazados',
                html: `<p>Haz clic en el enlace para restablecer tu contraseña: <a href="${enlace}">${enlace}</a></p>`
            };

            transporter.sendMail(mailOptions, () => {
                res.json({ message: "Si el correo está registrado, recibirás un enlace de recuperación." });
            });
        });
    });
});

app.post('/api/restablecer-password', (req, res) => {
    const { token, nuevaContrasena } = req.body;

    if (!token || !nuevaContrasena) {
        return res.status(400).json({ message: "Datos incompletos para restablecer la contraseña." });
    }

    if (typeof nuevaContrasena !== 'string' || nuevaContrasena.length < 6) {
        return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres." });
    }

    const sqlVerificarToken = `
        SELECT UsuarioID FROM Usuarios 
        WHERE TokenRecuperacion = ? AND ExpiracionToken > NOW()
    `;

    db.query(sqlVerificarToken, [token], (err, results) => {
        if (err || !results || results.length === 0) {
            return res.status(400).json({ message: "El token de recuperación es inválido o ha expirado." });
        }

        const usuarioId = results[0].UsuarioID;
        const sqlActualizarPass = `
            UPDATE Usuarios 
            SET ContrasenaHash = ?, TokenRecuperacion = NULL, ExpiracionToken = NULL 
            WHERE UsuarioID = ?
        `;

        const nuevoHash = bcrypt.hashSync(nuevaContrasena, BCRYPT_RONDAS);
        db.query(sqlActualizarPass, [nuevoHash, usuarioId], (errUpdate) => {
            if (errUpdate) {
                return res.status(500).json({ message: "Error al cambiar la contraseña." });
            }
            res.json({ message: "¡Contraseña actualizada con éxito! Ahora puedes iniciar sesión." });
        });
    });
});

// RUTAS PARA OFERTAS
app.get('/api/ofertas', (req, res) => {
    const query = `
        SELECT o.OfertaID, o.ProveedorID, o.TituloMaterial, o.Precio, o.UnidadMedida, o.DistanciaSimuladaKm, o.Fotos, c.NombreCategoria 
        FROM Ofertas o
        JOIN CategoriasMateriales c ON o.CategoriaID = c.CategoriaID
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error("❌ Error en GET /api/ofertas:", err.message);
            return res.status(500).json([]);
        }

        const leerFotos = (valor) => {
            try { return valor ? JSON.parse(valor) : []; } catch (e) { return []; }
        };
        const ofertasFormateadas = (results || []).map(oferta => ({
            ...oferta,
            Fotos: leerFotos(oferta.Fotos)
        }));

        res.json(ofertasFormateadas);
    });
});

app.post('/api/ofertas', verificarToken, soloRoles('proveedor'), (req, res) => {
    const { titulo, precio, unidad, distancia, categoriaId, fotos } = req.body;
    // El proveedor es SIEMPRE el usuario de la sesión, nunca el que envíe el navegador
    const proveedorId = req.usuario.id;

    if (!titulo || !precio || !unidad || !categoriaId) {
        return res.status(400).json({ message: "Por favor, llena todos los campos obligatorios." });
    }

    if (!(Number(precio) > 0)) {
        return res.status(400).json({ message: "El precio debe ser un número mayor que 0." });
    }

    db.getConnection((errConn, connection) => {
        if (errConn) {
            return res.status(500).json({ message: "Error al conectar con la base de datos." });
        }

        connection.beginTransaction((errTx) => {
            if (errTx) {
                connection.release();
                return res.status(500).json({ message: "Error al procesar el servidor." });
            }

            const fotosJSON = JSON.stringify(fotos || []);

            const queryInsertarOferta = `
                INSERT INTO Ofertas (ProveedorID, TituloMaterial, CategoriaID, Precio, UnidadMedida, DistanciaSimuladaKm, Fotos) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;

            connection.query(queryInsertarOferta, [proveedorId, titulo, categoriaId, precio, unidad, distancia || 0, fotosJSON], (errOferta) => {
                if (errOferta) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ message: "Error al guardar el material en la base de datos." });
                    });
                }

                const fechaFinSimulada = new Date();
                fechaFinSimulada.setDate(fechaFinSimulada.getDate() + 7);

                const queryInsertarSubasta = `
                    INSERT INTO Subastas (ProveedorID, TituloLote, PrecioBase, PrecioActual, FechaFin, Estado)
                    VALUES (?, ?, ?, ?, ?, 'Activa')
                `;

                const tituloLote = `Lote Subasta: ${titulo}`;

                connection.query(queryInsertarSubasta, [proveedorId, tituloLote, precio, precio, fechaFinSimulada], (errSubasta) => {
                    if (errSubasta) {
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ message: "Error al crear la subasta en la base de datos." });
                        });
                    }

                    connection.commit((errCommit) => {
                        if (errCommit) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ message: "Error al asentar los cambios." });
                            });
                        }
                        connection.release();
                        res.json({ message: "¡Material publicado y lote en subasta activo exitosamente!" });
                    });
                });
            });
        });
    });
});

app.delete('/api/ofertas/:id', verificarToken, (req, res) => {
    const ofertaId = req.params.id;

    // Un proveedor solo puede borrar sus propias ofertas; el admin puede borrar cualquiera
    const queryBorrarOferta = req.usuario.esAdmin
        ? `DELETE FROM Ofertas WHERE OfertaID = ?`
        : `DELETE FROM Ofertas WHERE OfertaID = ? AND ProveedorID = ?`;
    const parametros = req.usuario.esAdmin ? [ofertaId] : [ofertaId, req.usuario.id];

    db.query(queryBorrarOferta, parametros, (errOferta, resultOferta) => {
        if (errOferta) {
            return res.status(500).json({ message: "Error al remover la oferta." });
        }

        if (!resultOferta || resultOferta.affectedRows === 0) {
            return res.status(403).json({ message: "No tienes permiso para eliminar esta oferta o no existe." });
        }

        res.json({ success: true, message: "Oferta eliminada correctamente." });
    });
});

// RUTAS PARA SUBASTAS Y PUJAS
app.get('/api/subastas', (req, res) => {
    const query = `
        SELECT SubastaID, ProveedorID, TituloLote, PrecioBase, PrecioActual, FechaFin, Estado 
        FROM Subastas 
        WHERE Estado = 'Activa'
    `;
    db.query(query, (err, results) => {
        if (err) {
            console.error("❌ Error en GET /api/subastas:", err.message);
            return res.status(500).json([]);
        }
        res.json(results || []);
    });
});

app.post('/api/pujas', verificarToken, soloRoles('emprendedor'), (req, res) => {
    const { subastaId } = req.body;
    const montoPuja = Number(req.body.montoPuja);
    const emprendedorId = req.usuario.id;

    if (!subastaId || !(montoPuja > 0)) {
        return res.status(400).json({ message: "Datos de puja incompletos." });
    }

    // Se valida y actualiza en UNA sola consulta (atómica): la subasta debe estar activa,
    // no vencida, no ser propia y la puja debe superar el precio actual.
    // Así dos pujas simultáneas no pueden dejar un precio menor.
    const sqlActualizarSubasta = `
        UPDATE Subastas
        SET PrecioActual = ?
        WHERE SubastaID = ? AND Estado = 'Activa' AND FechaFin > NOW()
          AND PrecioActual < ? AND ProveedorID <> ?
    `;

    db.query(sqlActualizarSubasta, [montoPuja, subastaId, montoPuja, emprendedorId], (errUpdate, resultado) => {
        if (errUpdate) return res.status(500).json({ message: "No se pudo registrar la puja." });

        if (!resultado || resultado.affectedRows === 0) {
            return db.query('SELECT PrecioActual, Estado, FechaFin, ProveedorID FROM Subastas WHERE SubastaID = ?', [subastaId], (errS, filas) => {
                if (errS || !filas || filas.length === 0) {
                    return res.status(404).json({ message: "La subasta no existe." });
                }
                const s = filas[0];
                if (s.ProveedorID === emprendedorId) {
                    return res.status(403).json({ message: "No puedes pujar en tu propia subasta." });
                }
                if (s.Estado !== 'Activa' || new Date(s.FechaFin) <= new Date()) {
                    return res.status(409).json({ message: "Esta subasta ya finalizó." });
                }
                return res.status(409).json({
                    message: `Tu puja debe ser mayor al precio actual de C$${Number(s.PrecioActual).toLocaleString('es-NI')}.`,
                    precioActual: Number(s.PrecioActual)
                });
            });
        }

        const sqlInsertarPuja = `INSERT INTO Pujas (SubastaID, EmprendedorID, MontoPuja) VALUES (?, ?, ?)`;
        db.query(sqlInsertarPuja, [subastaId, emprendedorId, montoPuja], (err) => {
            if (err) return res.status(500).json({ message: "El precio se actualizó, pero no se guardó el historial de la puja." });
            res.json({ message: "¡Tu puja ha sido aceptada exitosamente!" });
        });
    });
});

// CHAT Y ESTADÍSTICAS GENERALES
app.get('/api/chat/contactos', verificarToken, (req, res) => {
    // Se excluye al propio usuario de su lista de contactos
    const query = `
        SELECT
            p.UsuarioID,
            p.NombreRazonSocial,
            COALESCE(u.TipoRol, 'Usuario') AS TipoRol,
            COALESCE(d.NombreDepartamento, 'Nicaragua') AS NombreDepartamento
        FROM PerfilesUsuarios p
        LEFT JOIN Usuarios u ON p.UsuarioID = u.UsuarioID
        LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
        WHERE p.UsuarioID <> ?
    `;

    db.query(query, [req.usuario.id], (err, results) => {
        if (err) return res.status(500).json([]);
        res.json(results || []);
    });
});

app.get('/api/chat/mensajes', verificarToken, (req, res) => {
    // Solo se pueden leer conversaciones en las que participa el usuario de la sesión
    const remitenteId = req.usuario.id;
    const { destinatarioId } = req.query;

    if (!destinatarioId) {
        return res.status(400).json({ message: "Faltan identificadores de usuario." });
    }

    const query = `
        SELECT MensajeID, RemitenteID, DestinatarioID, ContenidoTexto, FechaEnvio 
        FROM MensajesChat 
        WHERE (RemitenteID = ? AND DestinatarioID = ?) 
           OR (RemitenteID = ? AND DestinatarioID = ?)
        ORDER BY FechaEnvio ASC
    `;

    db.query(query, [remitenteId, destinatarioId, destinatarioId, remitenteId], (err, results) => {
        if (err) return res.status(500).json([]);
        res.json(results || []);
    });
});

app.post('/api/chat/enviar', verificarToken, (req, res) => {
    // El remitente es siempre el usuario de la sesión (nadie puede escribir "a nombre de" otro)
    const remitenteId = req.usuario.id;
    const { destinatarioId, texto } = req.body;

    if (!destinatarioId || typeof texto !== 'string' || !texto.trim()) {
        return res.status(400).json({ message: "Contenido del mensaje incompleto." });
    }

    if (texto.length > 2000) {
        return res.status(400).json({ message: "El mensaje es demasiado largo (máximo 2000 caracteres)." });
    }

    if (Number(destinatarioId) === remitenteId) {
        return res.status(400).json({ message: "No puedes enviarte mensajes a ti mismo." });
    }

    const query = `
        INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto) 
        VALUES (?, ?, ?)
    `;

    db.query(query, [remitenteId, destinatarioId, texto], (err) => {
        if (err) return res.status(500).json({ message: "Error interno al guardar mensaje." });
        res.json({ success: true, message: "Mensaje enviado y guardado." });
    });
});

app.get('/api/estadisticas', (req, res) => {
    const queryProveedores = "SELECT COUNT(*) AS total FROM Usuarios WHERE LOWER(TipoRol) = 'proveedor'";
    const queryEmprendedores = "SELECT COUNT(*) AS total FROM Usuarios WHERE LOWER(TipoRol) = 'emprendedor'";
    const querySubastas = "SELECT COUNT(*) AS total FROM Subastas WHERE Estado = 'Activa'";

    db.query(queryProveedores, (err, resultProv) => {
        if (err) return res.status(500).json({ proveedores: 0, emprendedores: 0, subastas: 0 });

        db.query(queryEmprendedores, (err, resultEmp) => {
            if (err) return res.status(500).json({ proveedores: 0, emprendedores: 0, subastas: 0 });

            db.query(querySubastas, (err, resultSub) => {
                if (err) return res.status(500).json({ proveedores: 0, emprendedores: 0, subastas: 0 });

                res.json({
                    proveedores: (resultProv && resultProv[0]) ? resultProv[0].total : 0,
                    emprendedores: (resultEmp && resultEmp[0]) ? resultEmp[0].total : 0,
                    subastas: (resultSub && resultSub[0]) ? resultSub[0].total : 0
                });
            });
        });
    });
});

app.get('/api/perfil/:id', verificarToken, (req, res) => {
    const usuarioId = req.params.id;

    // Cada usuario solo puede ver su propio perfil completo (correo, teléfono, RUC...)
    if (Number(usuarioId) !== req.usuario.id && !req.usuario.esAdmin) {
        return res.status(403).json({ message: "No tienes permiso para ver este perfil." });
    }

    const query = `
        SELECT 
            u.UsuarioID, 
            u.CorreoElectronico, 
            u.TipoRol, 
            u.EstadoCuenta,
            p.NombreRazonSocial, 
            p.TelefonoWhatsApp, 
            d.NombreDepartamento,
            prov.NumeroRUC, 
            prov.NombreComercial, 
            prov.TipoMateriaPrimaPrincipal, 
            prov.DescripcionEmpresa,
            emp.NombreMarca, 
            emp.EspecialidadCalzado, 
            emp.CapacidadProduccionMensual,
            adm.NivelAcceso
        FROM Usuarios u
        LEFT JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
        LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
        LEFT JOIN Proveedores prov ON u.UsuarioID = prov.UsuarioID
        LEFT JOIN Emprendedores emp ON u.UsuarioID = emp.UsuarioID
        LEFT JOIN Administradores adm ON u.UsuarioID = adm.UsuarioID
        WHERE u.UsuarioID = ?
    `;

    db.query(query, [usuarioId], (err, results) => {
        if (err) return res.status(500).json({ message: "Error al consultar la base de datos." });
        if (!results || results.length === 0) return res.status(404).json({ message: "Usuario no encontrado." });
        res.json(results[0]);
    });
});

/* ==========================================================================
   INCISO B: ENDPOINTS EXCLUSIVOS PARA ADMINISTRADORES
   ========================================================================== */

// 1. MÉTRICAS GLOBALES DEL SISTEMA FOR ADMIN
app.get('/api/admin/metricas', verificarAdmin, (req, res) => {
    const sqlMetricas = `
        SELECT 
            (SELECT COUNT(*) FROM Usuarios) AS totalUsuarios,
            (SELECT COUNT(*) FROM Usuarios WHERE LOWER(TipoRol) = 'proveedor') AS totalProveedores,
            (SELECT COUNT(*) FROM Usuarios WHERE LOWER(TipoRol) = 'emprendedor') AS totalEmprendedores,
            (SELECT COUNT(*) FROM Usuarios WHERE LOWER(TipoRol) IN ('administrador', 'admin')) AS totalAdmins,
            (SELECT COUNT(*) FROM Ofertas) AS totalOfertas,
            (SELECT COUNT(*) FROM Subastas WHERE Estado = 'Activa') AS subastasActivas,
            (SELECT COUNT(*) FROM MensajesChat) AS totalMensajes
    `;

    db.query(sqlMetricas, (err, results) => {
        if (err) {
            console.error("❌ Error al obtener métricas de admin:", err.message);
            return res.status(500).json({ message: "Error al consultar métricas del sistema." });
        }
        res.json(results[0] || {});
    });
});

// 2. LISTAR TODOS LOS USUARIOS DEL SISTEMA CON DETALLES
app.get('/api/admin/usuarios', verificarAdmin, (req, res) => {
    const sqlUsuarios = `
        SELECT 
            u.UsuarioID,
            u.CorreoElectronico,
            u.TipoRol,
            COALESCE(u.EstadoCuenta, 'Activo') AS EstadoCuenta,
            u.FechaRegistro AS FechaCreacion,
            p.NombreRazonSocial,
            p.TelefonoWhatsApp,
            d.NombreDepartamento
        FROM Usuarios u
        LEFT JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
        LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
        ORDER BY u.UsuarioID DESC
    `;

    db.query(sqlUsuarios, (err, results) => {
        if (err) {
            console.error("❌ Error al listar usuarios:", err.message);
            return res.status(500).json({ message: "Error al obtener lista de usuarios." });
        }
        res.json(results || []);
    });
});

// 3. CAMBIAR ESTADO DE UN USUARIO (Activo, Inactivo, Suspendido)
app.put('/api/admin/usuarios/:id/estado', verificarAdmin, (req, res) => {
    const usuarioIdTarget = req.params.id;
    const { nuevoEstado } = req.body;

    const estadosValidos = ['Activo', 'Inactivo', 'Suspendido'];
    if (!nuevoEstado || !estadosValidos.includes(nuevoEstado)) {
        return res.status(400).json({ message: "Estado no válido. Valores admitidos: Activo, Inactivo, Suspendido." });
    }

    const sqlActualizarEstado = `UPDATE Usuarios SET EstadoCuenta = ? WHERE UsuarioID = ?`;

    db.query(sqlActualizarEstado, [nuevoEstado, usuarioIdTarget], (err, result) => {
        if (err) {
            console.error("❌ Error al cambiar estado de usuario:", err.message);
            return res.status(500).json({ message: "Error al actualizar estado del usuario." });
        }
        if (!result || result.affectedRows === 0) {
            return res.status(404).json({ message: "Usuario no encontrado." });
        }
        res.json({ success: true, message: `Estado del usuario cambiado a '${nuevoEstado}'.` });
    });
});

// 4. ELIMINAR USUARIO POR COMPLETO (SOLO ADMIN)
app.delete('/api/admin/usuarios/:id', verificarAdmin, (req, res) => {
    const usuarioIdTarget = Number(req.params.id);

    if (usuarioIdTarget === req.usuario.id) {
        return res.status(400).json({ message: "No puedes eliminar tu propia cuenta de administrador." });
    }

    // Ofertas, Subastas, Pujas, MensajesChat y TratosCerrados apuntan al usuario SIN
    // "ON DELETE CASCADE", así que MySQL no deja borrarlo directamente.
    // Se eliminan primero sus registros, todo dentro de una transacción
    // (si algo falla no se borra nada).
    const pasos = [
        ['DELETE FROM MensajesChat WHERE RemitenteID = ? OR DestinatarioID = ?', [usuarioIdTarget, usuarioIdTarget]],
        ['DELETE FROM TratosCerrados WHERE ProveedorID = ? OR EmprendedorID = ?', [usuarioIdTarget, usuarioIdTarget]],
        ['DELETE FROM Pujas WHERE EmprendedorID = ?', [usuarioIdTarget]],
        ['DELETE FROM Subastas WHERE ProveedorID = ?', [usuarioIdTarget]],   // sus pujas se borran en cascada
        ['DELETE FROM Ofertas WHERE ProveedorID = ?', [usuarioIdTarget]],    // sus fotos se borran en cascada
        ['DELETE FROM Usuarios WHERE UsuarioID = ?', [usuarioIdTarget]]      // perfil, roles, etc. en cascada
    ];

    db.getConnection((errConn, conn) => {
        if (errConn) return res.status(500).json({ message: "Error al conectar con la base de datos." });

        const fallar = (err) => conn.rollback(() => {
            conn.release();
            console.error("❌ Error al eliminar usuario:", err.message);
            res.status(500).json({ message: "Error al eliminar usuario del sistema." });
        });

        conn.beginTransaction((errTx) => {
            if (errTx) { conn.release(); return res.status(500).json({ message: "Error al eliminar usuario del sistema." }); }

            const ejecutar = (i) => {
                const [sql, params] = pasos[i];
                conn.query(sql, params, (err, result) => {
                    if (err) return fallar(err);

                    if (i < pasos.length - 1) return ejecutar(i + 1);

                    // Último paso: el usuario en sí
                    if (!result || result.affectedRows === 0) {
                        return conn.rollback(() => {
                            conn.release();
                            res.status(404).json({ message: "El usuario a eliminar no existe." });
                        });
                    }
                    conn.commit((errCommit) => {
                        if (errCommit) return fallar(errCommit);
                        conn.release();
                        res.json({ success: true, message: "Usuario y sus registros asociados eliminados correctamente." });
                    });
                });
            };
            ejecutar(0);
        });
    });
});

// 5. MODERACIÓN DE CONTENIDO: ELIMINAR CUALQUIER OFERTA POR ADMIN
app.delete('/api/admin/ofertas/:id', verificarAdmin, (req, res) => {
    const ofertaId = req.params.id;

    const queryBorrarOfertaAdmin = `DELETE FROM Ofertas WHERE OfertaID = ?`;

    db.query(queryBorrarOfertaAdmin, [ofertaId], (err, result) => {
        if (err) {
            console.error("❌ Error al moderar oferta:", err.message);
            return res.status(500).json({ message: "Error al eliminar la publicación." });
        }
        if (!result || result.affectedRows === 0) {
            return res.status(404).json({ message: "La oferta no existe o ya fue eliminada." });
        }
        res.json({ success: true, message: "Publicación eliminada por moderación administrativa." });
    });
});

// 6. GESTIÓN DE CATEGORÍAS (AGREGAR NUEVAS CATEGORÍAS)
app.post('/api/admin/categorias', verificarAdmin, (req, res) => {
    const { nombreCategoria, descripcion } = req.body;

    if (!nombreCategoria || !nombreCategoria.trim()) {
        return res.status(400).json({ message: "El nombre de la categoría es obligatorio." });
    }

    const sqlInsertarCategoria = `
        INSERT INTO CategoriasMateriales (NombreCategoria, Descripcion) 
        VALUES (?, ?)
    `;

    db.query(sqlInsertarCategoria, [nombreCategoria.trim(), descripcion || null], (err, result) => {
        if (err) {
            console.error("❌ Error al crear categoría:", err.message);
            return res.status(500).json({ message: "Error al registrar la nueva categoría o ya existe." });
        }
        res.json({
            success: true,
            id: result.insertId,
            message: `Categoría '${nombreCategoria}' creada exitosamente.`
        });
    });
});

/* ==========================================================================
   CATEGORÍAS (pública): lista para los formularios de publicación
   ========================================================================== */
app.get('/api/categorias', async (req, res) => {
    try {
        const [filas] = await db.promise().query(
            'SELECT CategoriaID, NombreCategoria FROM CategoriasMateriales ORDER BY NombreCategoria'
        );
        res.json(filas);
    } catch (err) {
        console.error('❌ Error en GET /api/categorias:', err.message);
        res.status(500).json([]);
    }
});

/* ==========================================================================
   DASHBOARD: estadísticas agregadas de la plataforma + actividad propia
   ?meses=3|6|12 define el periodo de la gráfica de actividad
   ========================================================================== */
app.get('/api/dashboard', verificarToken, async (req, res) => {
    const PERIODOS = [3, 6, 12];
    const meses = PERIODOS.includes(Number(req.query.meses)) ? Number(req.query.meses) : 6;
    const q = async (sql, params = []) => (await db.promise().query(sql, params))[0];

    // Primer día del mes de inicio del periodo (ej. 6 meses = mes actual + 5 anteriores)
    const inicio = new Date();
    inicio.setDate(1);
    inicio.setHours(0, 0, 0, 0);
    inicio.setMonth(inicio.getMonth() - (meses - 1));

    try {
        const [resumen] = await q(`
            SELECT
                (SELECT COUNT(*) FROM Usuarios WHERE LOWER(TipoRol) = 'proveedor') AS proveedores,
                (SELECT COUNT(*) FROM Usuarios WHERE LOWER(TipoRol) = 'emprendedor') AS emprendedores,
                (SELECT COUNT(*) FROM Usuarios WHERE FechaRegistro >= NOW() - INTERVAL 30 DAY) AS nuevosUsuarios30d,
                (SELECT COUNT(*) FROM Ofertas) AS ofertas,
                (SELECT COUNT(*) FROM Ofertas WHERE FechaPublicacion >= NOW() - INTERVAL 30 DAY) AS ofertas30d,
                (SELECT COALESCE(AVG(Precio), 0) FROM Ofertas) AS precioPromedio,
                (SELECT COUNT(*) FROM Subastas WHERE Estado = 'Activa' AND FechaFin > NOW()) AS subastasActivas,
                (SELECT COUNT(*) FROM Subastas WHERE Estado <> 'Activa' OR FechaFin <= NOW()) AS subastasCerradas,
                (SELECT COALESCE(SUM(PrecioActual), 0) FROM Subastas WHERE Estado = 'Activa' AND FechaFin > NOW()) AS valorEnSubasta,
                (SELECT COUNT(*) FROM Pujas) AS pujas,
                (SELECT COUNT(*) FROM Pujas WHERE FechaPuja >= NOW() - INTERVAL 30 DAY) AS pujas30d,
                (SELECT COUNT(*) FROM MensajesChat) AS mensajes,
                (SELECT COUNT(*) FROM MensajesChat WHERE FechaEnvio >= NOW() - INTERVAL 30 DAY) AS mensajes30d
        `);

        const categorias = await q(`
            SELECT c.NombreCategoria AS categoria,
                   COUNT(o.OfertaID) AS ofertas,
                   COALESCE(AVG(o.Precio), 0) AS precioPromedio,
                   COALESCE(MIN(o.Precio), 0) AS precioMinimo,
                   COALESCE(MAX(o.Precio), 0) AS precioMaximo
            FROM CategoriasMateriales c
            JOIN Ofertas o ON o.CategoriaID = c.CategoriaID
            GROUP BY c.CategoriaID, c.NombreCategoria
            ORDER BY ofertas DESC, categoria
        `);

        const departamentos = await q(`
            SELECT d.NombreDepartamento AS departamento,
                   SUM(LOWER(u.TipoRol) = 'proveedor') AS proveedores,
                   SUM(LOWER(u.TipoRol) = 'emprendedor') AS emprendedores
            FROM PerfilesUsuarios p
            JOIN Usuarios u ON u.UsuarioID = p.UsuarioID
            JOIN Departamentos d ON d.DepartamentoID = p.DepartamentoID
            WHERE LOWER(u.TipoRol) IN ('proveedor', 'emprendedor')
            GROUP BY d.DepartamentoID, d.NombreDepartamento
            ORDER BY (proveedores + emprendedores) DESC, departamento
        `);

        const filasActividad = await q(`
            SELECT 'registros' AS tipo, DATE_FORMAT(FechaRegistro, '%Y-%m') AS mes, COUNT(*) AS total
              FROM Usuarios WHERE FechaRegistro >= ? GROUP BY mes
            UNION ALL
            SELECT 'ofertas', DATE_FORMAT(FechaPublicacion, '%Y-%m'), COUNT(*)
              FROM Ofertas WHERE FechaPublicacion >= ? GROUP BY 2
            UNION ALL
            SELECT 'pujas', DATE_FORMAT(FechaPuja, '%Y-%m'), COUNT(*)
              FROM Pujas WHERE FechaPuja >= ? GROUP BY 2
        `, [inicio, inicio, inicio]);

        // Se arma la serie mes a mes (incluye los meses sin actividad, en 0)
        const actividad = [];
        for (let i = 0; i < meses; i++) {
            const f = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
            const clave = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
            const fila = { mes: clave, registros: 0, ofertas: 0, pujas: 0 };
            filasActividad.filter(a => a.mes === clave).forEach(a => { fila[a.tipo] = Number(a.total); });
            actividad.push(fila);
        }

        const subastas = await q(`
            SELECT s.SubastaID AS id, s.TituloLote AS lote,
                   COALESCE(pr.NombreRazonSocial, 'Proveedor') AS proveedor,
                   s.PrecioBase AS precioBase, s.PrecioActual AS precioActual,
                   s.FechaFin AS fechaFin, COUNT(pj.PujaID) AS pujas,
                   (s.ProveedorID = ?) AS esMia
            FROM Subastas s
            LEFT JOIN Pujas pj ON pj.SubastaID = s.SubastaID
            LEFT JOIN PerfilesUsuarios pr ON pr.UsuarioID = s.ProveedorID
            WHERE s.Estado = 'Activa' AND s.FechaFin > NOW()
            GROUP BY s.SubastaID
            ORDER BY pujas DESC, s.FechaFin ASC
            LIMIT 100
        `, [req.usuario.id]);

        // Los nombres de los postores solo los ve el administrador
        const pujasRecientes = await q(`
            SELECT pj.MontoPuja AS monto, pj.FechaPuja AS fecha, s.TituloLote AS lote,
                   ${req.usuario.esAdmin ? "COALESCE(pe.NombreRazonSocial, 'Emprendedor')" : 'NULL'} AS postor,
                   (pj.EmprendedorID = ?) AS esMia
            FROM Pujas pj
            JOIN Subastas s ON s.SubastaID = pj.SubastaID
            LEFT JOIN PerfilesUsuarios pe ON pe.UsuarioID = pj.EmprendedorID
            ORDER BY pj.FechaPuja DESC, pj.PujaID DESC
            LIMIT 15
        `, [req.usuario.id]);

        // ACTIVIDAD PROPIA SEGÚN EL ROL
        const yo = req.usuario.id;
        let miActividad = { rol: req.usuario.rol };
        if (req.usuario.rol === 'proveedor') {
            const [m] = await q(`
                SELECT
                    (SELECT COUNT(*) FROM Ofertas WHERE ProveedorID = ?) AS misOfertas,
                    (SELECT COUNT(*) FROM Subastas WHERE ProveedorID = ? AND Estado = 'Activa' AND FechaFin > NOW()) AS misSubastasActivas,
                    (SELECT COUNT(*) FROM Pujas pj JOIN Subastas s ON s.SubastaID = pj.SubastaID WHERE s.ProveedorID = ?) AS pujasRecibidas,
                    (SELECT COALESCE(SUM(PrecioActual), 0) FROM Subastas WHERE ProveedorID = ? AND Estado = 'Activa' AND FechaFin > NOW()) AS valorMisSubastas,
                    (SELECT COUNT(*) FROM MensajesChat WHERE DestinatarioID = ?) AS mensajesRecibidos
            `, [yo, yo, yo, yo, yo]);
            miActividad = { ...miActividad, ...m };
        } else if (req.usuario.rol === 'emprendedor') {
            const [m] = await q(`
                SELECT
                    (SELECT COUNT(*) FROM Pujas WHERE EmprendedorID = ?) AS misPujas,
                    (SELECT COUNT(DISTINCT SubastaID) FROM Pujas WHERE EmprendedorID = ?) AS subastasParticipando,
                    (SELECT COUNT(*) FROM Subastas s
                       WHERE s.Estado = 'Activa' AND s.FechaFin > NOW()
                         AND s.PrecioActual = (SELECT MAX(MontoPuja) FROM Pujas WHERE SubastaID = s.SubastaID AND EmprendedorID = ?)) AS subastasLiderando,
                    (SELECT COALESCE(SUM(s.PrecioActual), 0) FROM Subastas s
                       WHERE s.Estado = 'Activa' AND s.FechaFin > NOW()
                         AND s.PrecioActual = (SELECT MAX(MontoPuja) FROM Pujas WHERE SubastaID = s.SubastaID AND EmprendedorID = ?)) AS montoLiderando,
                    (SELECT COUNT(*) FROM MensajesChat WHERE DestinatarioID = ?) AS mensajesRecibidos
            `, [yo, yo, yo, yo, yo]);
            miActividad = { ...miActividad, ...m };
        }

        // mysql2 devuelve DECIMAL y SUM como texto: se convierten a número
        const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) =>
            [k, (typeof v === 'string' && v !== '' && !isNaN(v) && !['categoria', 'departamento', 'lote', 'proveedor', 'mes', 'rol', 'postor'].includes(k)) ? Number(v) : v]));

        res.json({
            generado: new Date().toISOString(),
            periodoMeses: meses,
            esAdmin: req.usuario.esAdmin,
            resumen: num(resumen),
            categorias: categorias.map(num),
            departamentos: departamentos.map(num),
            actividad,
            subastas: subastas.map(s => ({ ...num(s), esMia: !!s.esMia })),
            pujasRecientes: pujasRecientes.map(p => ({ ...num(p), esMia: !!p.esMia })),
            miActividad: num(miActividad)
        });
    } catch (err) {
        console.error('❌ Error en GET /api/dashboard:', err.message);
        res.status(500).json({ message: 'No se pudieron calcular las estadísticas del dashboard.' });
    }
});

// SERVIR ARCHIVOS ESTÁTICOS
// Solo se publica la carpeta "public": así index.js, .env y web.config
// nunca se pueden descargar desde el navegador.
// La raíz "/" muestra preview.html (igual que en web.config de IIS)
app.use(express.static(path.join(__dirname, 'public'), { index: 'preview.html' }));

// Rutas de API inexistentes
app.use('/api', (req, res) => {
    res.status(404).json({ message: "Ruta no encontrada." });
});

// MANEJADOR GLOBAL DE ERRORES: nunca mostrar el detalle interno al usuario
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ message: "Formato de datos inválido." });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ message: "Los datos enviados son demasiado grandes." });
    }
    console.error('❌ Error no controlado:', err.stack || err.message);
    res.status(500).json({ message: "Error interno del servidor." });
});

// PUERTO Y ESCUCHA
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 Servidor Backend ejecutándose en el puerto ${PORT}`);
});