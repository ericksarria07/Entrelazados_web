// El .env se busca junto a este archivo, sin importar desde qué carpeta
// se inicie el servidor (PM2, systemd, IIS...)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { crearServicioCorreo } = require('./correo');
const limites = require('./limites');
const fotos = require('./fotos');
const { crearCierreSubastas, avisarPujadoresCancelacion } = require('./subastas');
const { crearServicioTratos } = require('./tratos');
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

// PROXY: si algún día se pone nginx delante, TRUST_PROXY=1 en el .env para que
// req.ip sea la IP real del visitante (y no la de nginx) en los límites de intentos.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

// CORS: las páginas salen de este mismo servidor, así que no hace falta abrir
// la API a otros sitios. Si se necesitara, se listan en CORS_ORIGENES (separados por coma).
const origenesPermitidos = (process.env.CORS_ORIGENES || '').split(',').map(o => o.trim()).filter(Boolean);
if (origenesPermitidos.length > 0) {
    app.use(cors({ origin: origenesPermitidos }));
}

// PARSEO DE PETICIONES JSON (las fotos viajan aparte como archivos, ver fotos.js)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Límite general de peticiones a la API por IP (ver limites.js)
app.use('/api', limites.api);

// INICIALIZACIÓN SEGURA DE GEMINI API
// GEMINI_MODELO (opcional) permite cambiar de modelo sin tocar el código.
// Para probar la clave y el modelo: node backend/scripts/probar_gemini.js
const MODELO_GEMINI = (process.env.GEMINI_MODELO || '').trim() || 'gemini-3.8-flash';
let ai = null;
try {
    const apiKey = process.env.GEMINI_API_KEY || 'CLAVE_TEMPORAL';
    if (!process.env.GEMINI_API_KEY) console.warn('⚠️ GEMINI_API_KEY no está en el .env: Kan solo dará sus respuestas fijas.');
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
// La misma regla escrita para MySQL (REGEXP), para buscar correos inválidos en la base
const REGEXP_EMAIL_SQL = '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]{2,}$';

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

// CORREO (recuperación de contraseña), ver correo.js. Opcional: si EMAIL_USER /
// EMAIL_PASS no están en el .env, el enlace se escribe en el log (pm2 logs).
const correo = crearServicioCorreo();
if (!correo.configurado) {
    console.warn('⚠️ EMAIL_USER / EMAIL_PASS no están en el .env: los enlaces de recuperación solo se mostrarán en el log.');
} else {
    correo.verificar().then(({ ok, motivo }) => {
        if (ok) console.log(`✅ Correo listo: los enlaces de recuperación se envían desde ${correo.remitente}.`);
        else console.error(`❌ El correo de recuperación NO funciona: ${motivo}`);
    });
}

// VERIFICACIÓN DEL CORREO AL REGISTRARSE
// VERIFICAR_CORREO=1 la exige siempre, VERIFICAR_CORREO=0 la apaga. Si no se indica,
// se exige solo cuando el correo está configurado (sin correo nadie recibiría el enlace).
// Las cuentas que ya existían quedan verificadas (ver sql/migracion_v10.sql).
const modoVerificacion = (process.env.VERIFICAR_CORREO || '').trim();
const VERIFICAR_CORREO = modoVerificacion === '1' || (modoVerificacion !== '0' && correo.configurado);
const VIGENCIA_VERIFICACION_MS = 24 * 60 * 60 * 1000;
console.log(VERIFICAR_CORREO
    ? '✅ Las cuentas nuevas deben confirmar su correo antes de iniciar sesión.'
    : '⚠️ Verificación de correo desactivada: las cuentas nuevas entran sin confirmar su correo.');

// Dirección pública del sitio para los enlaces de los correos.
// APP_URL (opcional) la fija, p. ej. https://entrelazados.com
const urlPublica = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

// PAGINACIÓN: ?pagina=N&porPagina=M. Si no se pide ?pagina, las rutas devuelven
// la lista completa como antes (compatibilidad con pantallas y scripts viejos).
function leerPaginacion(query, porPaginaDefecto = 12, maximo = 50) {
    if (query.pagina === undefined) return null;
    const pagina = Math.max(1, parseInt(query.pagina, 10) || 1);
    const porPagina = Math.min(maximo, Math.max(1, parseInt(query.porPagina, 10) || porPaginaDefecto));
    return { pagina, porPagina, offset: (pagina - 1) * porPagina };
}
const respuestaPaginada = (datos, total, p) => ({
    datos,
    total,
    pagina: p.pagina,
    porPagina: p.porPagina,
    paginas: Math.max(1, Math.ceil(total / p.porPagina))
});
// Texto para buscar con LIKE: los comodines % y _ que escriba el usuario se toman literales
const patronLike = (texto) => `%${String(texto).trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
const enteroPositivo = (valor) => {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : null;
};

// CIERRE AUTOMÁTICO DE SUBASTAS VENCIDAS (ver subastas.js)
const cierreSubastas = crearCierreSubastas({
    db,
    correo,
    urlBase: (process.env.APP_URL || '').replace(/\/+$/, '') || null
});
const intervaloCierre = Number(process.env.INTERVALO_CIERRE_SUBASTAS_SEG);
cierreSubastas.iniciar(Number.isInteger(intervaloCierre) && intervaloCierre >= 10 ? intervaloCierre : 60);

// SEGUIMIENTO DE TRATOS: pendiente → en proceso → completado / cancelado (ver tratos.js)
const tratos = crearServicioTratos({
    db,
    correo,
    urlBase: (process.env.APP_URL || '').replace(/\/+$/, '') || null
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
    res.json({ status: 'ok', message: 'API de EntreLazados operando.' });
});

/* ==========================================================================
   ENDPOINT PARA LA IA DE KAN (RANDAL) - CON SOPORTE ADMIN
   Requiere sesión: así cada pregunta cuenta para un usuario concreto y nadie
   puede gastar la cuota de Gemini desde fuera de la plataforma.
   ========================================================================== */
app.post('/api/chat/ia', verificarToken, limites.kanMinuto, limites.kanDia, (req, res) => {
    const { mensajeUsuario } = req.body;
    // El rol sale de la sesión, no de lo que diga el navegador
    const rolUsuario = req.usuario.rol;

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
            respuesta: "En el Mercado, cada publicación tuya tiene los botones Editar y Eliminar. Con Editar cambias el título, el precio, la categoría o las fotos (si tiene una subasta abierta, también se actualiza su título). Con Eliminar retiras el material de la vista pública; si su subasta ya recibió pujas, tendrás que esperar a que cierre."
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
                    model: MODELO_GEMINI,
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
app.post('/registro', limites.registro, (req, res) => {
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

                    // Si hay que confirmar el correo, la cuenta nace sin verificar y con un enlace de 24 h
                    const tokenVerificacion = VERIFICAR_CORREO ? crypto.randomBytes(32).toString('hex') : null;
                    const sqlUsuario = `
                        INSERT INTO Usuarios (CorreoElectronico, ContrasenaHash, TipoRol, EstadoCuenta,
                                              CorreoVerificado, TokenVerificacion, ExpiracionVerificacion)
                        VALUES (?, ?, ?, 'Activo', ?, ?, ?)
                    `;
                    const paramsUsuario = [emailLimpio, passwordHash, rol, VERIFICAR_CORREO ? 0 : 1, tokenVerificacion,
                        VERIFICAR_CORREO ? new Date(Date.now() + VIGENCIA_VERIFICACION_MS) : null];

                    connection.query(sqlUsuario, paramsUsuario, (errUser, resultUser) => {
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
                                    if (!VERIFICAR_CORREO) {
                                        return res.json({ message: "¡Registro exitoso en la plataforma!" });
                                    }
                                    enviarEnlaceVerificacion(emailLimpio, tokenVerificacion, urlPublica(req));
                                    res.json({
                                        message: `¡Registro exitoso! Te enviamos un correo a ${emailLimpio} para confirmar tu cuenta. Abre el enlace antes de iniciar sesión.`,
                                        verificacionPendiente: true
                                    });
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
app.post('/api/login', limites.login, (req, res) => {
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
        SELECT u.UsuarioID, u.ContrasenaHash, u.TipoRol, u.EstadoCuenta, u.CorreoVerificado, p.NombreRazonSocial, d.NombreDepartamento
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

        // Cuenta nueva que todavía no abrió el enlace de confirmación
        if (Number(usuario.CorreoVerificado) === 0) {
            return res.status(403).json({
                message: "Antes de entrar, confirma tu correo: abre el enlace que te enviamos al registrarte. Si no te llegó (revisa también Spam), pide otro aquí.",
                verificacionPendiente: true
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

// RUTAS DE RECUPERACIÓN DE CONTRASEÑA
const MENSAJE_RECUPERACION = "Si el correo está registrado, recibirás un enlace de recuperación en unos minutos.";
const ESPERA_REENVIO_MS = 60 * 1000;          // 1 correo por minuto por dirección
const VIGENCIA_TOKEN_MS = 60 * 60 * 1000;     // el enlace vale 1 hora
const ultimosEnvios = new Map();              // correo -> momento del último envío

// "erick@gmail.com" -> "e***k@gmail.com" (para mostrar sin revelar el correo completo)
function ocultarCorreo(correo) {
    const [nombre, dominio] = String(correo).split('@');
    if (!dominio) return '';
    const visible = nombre.length <= 2 ? nombre[0] + '***' : nombre[0] + '***' + nombre[nombre.length - 1];
    return `${visible}@${dominio}`;
}

app.post('/api/solicitar-recuperacion', limites.recuperacion, async (req, res) => {
    const emailLimpio = typeof req.body.email === 'string' ? req.body.email.trim() : '';

    if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({ message: "Por favor proporciona un correo electrónico válido." });
    }

    // Siempre se responde lo mismo, exista o no la cuenta, para no revelar qué correos están registrados
    const clave = emailLimpio.toLowerCase();
    const ahora = Date.now();
    if (ultimosEnvios.has(clave) && ahora - ultimosEnvios.get(clave) < ESPERA_REENVIO_MS) {
        return res.json({ message: MENSAJE_RECUPERACION });
    }
    ultimosEnvios.set(clave, ahora);
    if (ultimosEnvios.size > 1000) {
        for (const [c, t] of ultimosEnvios) if (ahora - t > ESPERA_REENVIO_MS) ultimosEnvios.delete(c);
    }

    try {
        const [usuarios] = await db.promise().query(
            "SELECT UsuarioID, CorreoElectronico FROM Usuarios WHERE CorreoElectronico = ? AND (EstadoCuenta IS NULL OR EstadoCuenta <> 'Suspendido')",
            [emailLimpio]
        );
        if (usuarios.length === 0) return res.json({ message: MENSAJE_RECUPERACION });

        const token = crypto.randomBytes(32).toString('hex');
        await db.promise().query(
            'UPDATE Usuarios SET TokenRecuperacion = ?, ExpiracionToken = ? WHERE UsuarioID = ?',
            [token, new Date(ahora + VIGENCIA_TOKEN_MS), usuarios[0].UsuarioID]
        );

        const base = urlPublica(req);
        const enlace = `${base}/restablecer.html?token=${token}`;

        if (!correo.configurado) {
            console.warn(`🔑 Enlace de recuperación para ${emailLimpio} (correo no configurado): ${enlace}`);
            return res.json({ message: MENSAJE_RECUPERACION });
        }

        // Se responde sin esperar al envío; el resultado queda en el log
        correo.enviarRecuperacion(usuarios[0].CorreoElectronico, enlace, base)
            .then(() => console.log(`📧 Correo de recuperación enviado a ${emailLimpio}`))
            .catch((errCorreo) => console.error(`❌ No se pudo enviar el correo de recuperación a ${emailLimpio}: ${errCorreo.message}`));
        res.json({ message: MENSAJE_RECUPERACION });
    } catch (error) {
        console.error('Error en solicitar-recuperacion:', error.message);
        res.status(500).json({ message: "Error interno al generar el enlace. Intenta de nuevo." });
    }
});

// Permite a restablecer.html saber, antes de escribir la contraseña, si el enlace sigue vigente
app.get('/api/validar-token-recuperacion', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ valido: false });
    try {
        const [filas] = await db.promise().query(
            'SELECT CorreoElectronico, ExpiracionToken FROM Usuarios WHERE TokenRecuperacion = ? AND ExpiracionToken > NOW()',
            [token]
        );
        if (filas.length === 0) return res.status(400).json({ valido: false });
        res.json({ valido: true, correo: ocultarCorreo(filas[0].CorreoElectronico), expira: filas[0].ExpiracionToken });
    } catch (error) {
        console.error('Error en validar-token-recuperacion:', error.message);
        res.status(500).json({ valido: false });
    }
});

app.post('/api/restablecer-password', limites.recuperacion, (req, res) => {
    const { token, nuevaContrasena } = req.body;

    if (!token || !nuevaContrasena) {
        return res.status(400).json({ message: "Datos incompletos para restablecer la contraseña." });
    }

    if (typeof token !== 'string' || typeof nuevaContrasena !== 'string' || nuevaContrasena.length < 6) {
        return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres." });
    }

    if (Buffer.byteLength(nuevaContrasena, 'utf8') > 72) {
        return res.status(400).json({ message: "La contraseña es demasiado larga (máximo 72 caracteres)." });
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
            SET ContrasenaHash = ?, TokenRecuperacion = NULL, ExpiracionToken = NULL,
                -- Abrir el enlace que llegó al correo demuestra que el correo es suyo
                CorreoVerificado = 1, TokenVerificacion = NULL, ExpiracionVerificacion = NULL
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

// CONFIRMACIÓN DEL CORREO AL REGISTRARSE
// Manda el enlace (o lo escribe en el log si el correo no está configurado). No bloquea la respuesta.
function enviarEnlaceVerificacion(email, token, base) {
    const enlace = `${base}/verificar.html?token=${token}`;
    if (!correo.configurado) {
        console.warn(`✉️ Enlace para confirmar el correo de ${email} (correo no configurado): ${enlace}`);
        return;
    }
    correo.enviarVerificacion(email, enlace)
        .then(() => console.log(`📧 Correo de confirmación enviado a ${email}`))
        .catch((err) => console.error(`❌ No se pudo enviar la confirmación a ${email}: ${err.message}`));
}

app.get('/api/verificar-correo', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const invalido = { ok: false, message: "El enlace no es válido o ya venció. Inicia sesión y pide uno nuevo." };
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json(invalido);
    try {
        const [resultado] = await db.promise().query(
            `UPDATE Usuarios SET CorreoVerificado = 1, TokenVerificacion = NULL, ExpiracionVerificacion = NULL
             WHERE TokenVerificacion = ? AND ExpiracionVerificacion > NOW()`,
            [token]
        );
        if (resultado.affectedRows === 0) return res.status(400).json(invalido);
        res.json({ ok: true, message: "¡Listo! Tu correo quedó confirmado. Ya puedes iniciar sesión." });
    } catch (err) {
        console.error('Error en verificar-correo:', err.message);
        res.status(500).json({ ok: false, message: "No se pudo confirmar el correo. Intenta de nuevo." });
    }
});

// Reenviar el enlace de confirmación. Responde siempre lo mismo para no revelar qué correos existen.
const MENSAJE_REENVIO = "Si la cuenta existe y falta confirmarla, te enviamos un enlace nuevo. Revisa también la carpeta Spam.";
app.post('/api/reenviar-verificacion', limites.recuperacion, async (req, res) => {
    const emailLimpio = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({ message: "Ingresa un correo electrónico válido." });
    }
    const clave = 'verificar:' + emailLimpio.toLowerCase();
    const ahora = Date.now();
    if (ultimosEnvios.has(clave) && ahora - ultimosEnvios.get(clave) < ESPERA_REENVIO_MS) {
        return res.json({ message: MENSAJE_REENVIO });
    }
    ultimosEnvios.set(clave, ahora);
    try {
        const [usuarios] = await db.promise().query(
            'SELECT UsuarioID, CorreoElectronico FROM Usuarios WHERE CorreoElectronico = ? AND CorreoVerificado = 0',
            [emailLimpio]
        );
        if (usuarios.length === 0) return res.json({ message: MENSAJE_REENVIO });
        const token = crypto.randomBytes(32).toString('hex');
        await db.promise().query(
            'UPDATE Usuarios SET TokenVerificacion = ?, ExpiracionVerificacion = ? WHERE UsuarioID = ?',
            [token, new Date(ahora + VIGENCIA_VERIFICACION_MS), usuarios[0].UsuarioID]
        );
        enviarEnlaceVerificacion(usuarios[0].CorreoElectronico, token, urlPublica(req));
        res.json({ message: MENSAJE_REENVIO });
    } catch (err) {
        console.error('Error en reenviar-verificacion:', err.message);
        res.status(500).json({ message: "No se pudo enviar el enlace. Intenta de nuevo." });
    }
});

// RUTAS PARA OFERTAS

// Las fotos nuevas están en la tabla FotosOfertas (archivos en disco, ver fotos.js).
// Las ofertas antiguas guardaban sus fotos como texto JSON en Ofertas.Fotos:
// se siguen mostrando mientras no tengan fotos en la tabla.
const leerFotosAntiguas = (valor) => {
    try {
        const lista = valor ? JSON.parse(valor) : [];
        return Array.isArray(lista) ? lista.filter(f => typeof f === 'string') : [];
    } catch (e) { return []; }
};

// Direcciones de las fotos (en disco) de las ofertas indicadas, por OfertaID
async function urlsDeFotos(ofertaIds) {
    if (!ofertaIds.length) return new Map();
    const [filas] = await db.promise().query(
        'SELECT OfertaID, FotoURL FROM FotosOfertas WHERE OfertaID IN (?) ORDER BY EsPrincipal DESC, FotoID',
        [ofertaIds]
    );
    const mapa = new Map();
    for (const f of filas) {
        if (!mapa.has(f.OfertaID)) mapa.set(f.OfertaID, []);
        mapa.get(f.OfertaID).push(f.FotoURL);
    }
    return mapa;
}

// Filtros opcionales: ?q=texto&categoria=ID&maxKm=30&proveedorId=ID
// Con ?pagina=N&porPagina=M responde { datos, total, pagina, porPagina, paginas }.
// Cada oferta trae el nombre de su proveedor y su calificación promedio.
app.get('/api/ofertas', async (req, res) => {
    const pag = leerPaginacion(req.query, 12);
    const condiciones = [];
    const params = [];
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
        condiciones.push('o.TituloMaterial LIKE ?');
        params.push(patronLike(req.query.q));
    }
    const categoria = enteroPositivo(req.query.categoria);
    if (categoria) { condiciones.push('o.CategoriaID = ?'); params.push(categoria); }
    const maxKm = Number(req.query.maxKm);
    if (req.query.maxKm !== undefined && req.query.maxKm !== '' && Number.isFinite(maxKm)) {
        condiciones.push('o.DistanciaSimuladaKm <= ?');
        params.push(maxKm);
    }
    const proveedor = enteroPositivo(req.query.proveedorId);
    if (proveedor) { condiciones.push('o.ProveedorID = ?'); params.push(proveedor); }
    const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';

    try {
        const [ofertas] = await db.promise().query(`
            SELECT o.OfertaID, o.ProveedorID, o.TituloMaterial, o.Precio, o.UnidadMedida, o.DistanciaSimuladaKm, o.Fotos,
                   o.CategoriaID, c.NombreCategoria, o.FechaPublicacion,
                   COALESCE(pr.NombreRazonSocial, 'Proveedor') AS NombreProveedor,
                   cal.Promedio AS CalificacionProveedor, COALESCE(cal.Total, 0) AS TotalCalificaciones
            FROM Ofertas o
            JOIN CategoriasMateriales c ON o.CategoriaID = c.CategoriaID
            LEFT JOIN PerfilesUsuarios pr ON pr.UsuarioID = o.ProveedorID
            LEFT JOIN (SELECT CalificadoID, AVG(Puntuacion) AS Promedio, COUNT(*) AS Total
                       FROM Calificaciones GROUP BY CalificadoID) cal ON cal.CalificadoID = o.ProveedorID
            ${where}
            ORDER BY o.FechaPublicacion DESC, o.OfertaID DESC
            ${pag ? 'LIMIT ? OFFSET ?' : ''}
        `, pag ? [...params, pag.porPagina, pag.offset] : params);
        const fotosPorOferta = await urlsDeFotos(ofertas.map(o => o.OfertaID));
        const lista = ofertas.map(oferta => ({
            ...oferta,
            Fotos: fotosPorOferta.get(oferta.OfertaID) || leerFotosAntiguas(oferta.Fotos),
            CalificacionProveedor: oferta.CalificacionProveedor === null ? null : Math.round(Number(oferta.CalificacionProveedor) * 10) / 10,
            TotalCalificaciones: Number(oferta.TotalCalificaciones)
        }));
        if (!pag) return res.json(lista);
        const [[{ total }]] = await db.promise().query(`SELECT COUNT(*) AS total FROM Ofertas o ${where}`, params);
        res.json(respuestaPaginada(lista, Number(total), pag));
    } catch (err) {
        console.error("❌ Error en GET /api/ofertas:", err.message);
        res.status(500).json([]);
    }
});

// Error con código HTTP: la ruta responde su mensaje tal cual
const errorDeUsuario = (status, message) => Object.assign(new Error(message), { status });

// SUBASTAS: duración permitida y precio máximo (DECIMAL(10,2) llega hasta 99.999.999,99)
const DIAS_SUBASTA = { minimo: 1, maximo: 14, porDefecto: 7 };
const PRECIO_MAXIMO = 99999999;

// Valida los campos de una publicación (al crearla y al editarla).
// Devuelve { error } o los datos ya limpios.
function validarOferta(body) {
    const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
    const unidad = typeof body.unidad === 'string' ? body.unidad.trim() : '';
    const precio = Number(body.precio);
    const categoriaId = enteroPositivo(body.categoriaId);
    if (!titulo || !body.precio || !unidad || !categoriaId) return { error: "Por favor, llena todos los campos obligatorios." };
    if (titulo.length > 120) return { error: "El título puede tener como máximo 120 caracteres." };
    if (unidad.length > 30) return { error: "La unidad de medida puede tener como máximo 30 caracteres." };
    if (!(precio > 0) || precio > PRECIO_MAXIMO) return { error: "El precio debe ser un número mayor que 0." };
    const distancia = Math.max(0, Math.min(10000, Math.round(Number(body.distancia) || 0)));
    return { titulo, unidad, precio, categoriaId, distancia };
}

const esCategoriaInvalida = (err) => err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW';

// Crea una subasta dentro de una transacción ya abierta (conn).
// ofertaId liga el lote a su publicación: así muestra sus fotos y se cancela si la publicación se borra.
async function insertarSubasta(conn, { proveedorId, ofertaId = null, categoriaId, titulo, precioBase, dias = DIAS_SUBASTA.porDefecto }) {
    const fechaFin = new Date();
    fechaFin.setDate(fechaFin.getDate() + dias);
    const [resultado] = await conn.query(
        `INSERT INTO Subastas (ProveedorID, OfertaID, CategoriaID, TituloLote, PrecioBase, PrecioActual, FechaFin, Estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Activa')`,
        [proveedorId, ofertaId, categoriaId, `Lote Subasta: ${titulo}`, precioBase, precioBase, fechaFin]
    );
    return { subastaId: resultado.insertId, fechaFin };
}

// Acepta JSON (sin fotos) o multipart/form-data con hasta 5 archivos en el campo "fotos"
app.post('/api/ofertas', verificarToken, soloRoles('proveedor'), limites.fotos, fotos.recibirFotos, async (req, res) => {
    // El proveedor es SIEMPRE el usuario de la sesión, nunca el que envíe el navegador
    const proveedorId = req.usuario.id;
    const archivos = req.files || [];
    const datos = validarOferta(req.body);
    if (datos.error) {
        return res.status(400).json({ message: datos.error });
    }
    const { titulo: tituloLimpio, precio, unidad, distancia, categoriaId } = datos;
    const errorFotos = fotos.validarFotos(archivos);
    if (errorFotos) {
        return res.status(400).json({ message: errorFotos });
    }

    // Primero se guardan los archivos; si la base de datos falla, se borran
    let urls = [];
    let conn;
    try {
        urls = await fotos.guardarFotos(archivos);
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [oferta] = await conn.query(
            `INSERT INTO Ofertas (ProveedorID, TituloMaterial, CategoriaID, Precio, UnidadMedida, DistanciaSimuladaKm)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [proveedorId, tituloLimpio, categoriaId, precio, unidad, distancia]
        );

        if (urls.length > 0) {
            await conn.query(
                'INSERT INTO FotosOfertas (OfertaID, FotoURL, EsPrincipal) VALUES ?',
                [urls.map((url, i) => [oferta.insertId, url, i === 0 ? 1 : 0])]
            );
        }

        await insertarSubasta(conn, {
            proveedorId,
            ofertaId: oferta.insertId,
            categoriaId,
            titulo: tituloLimpio,
            precioBase: precio
        });

        await conn.commit();
        res.json({
            message: "¡Material publicado y lote en subasta activo exitosamente!",
            ofertaId: oferta.insertId,
            fotos: urls
        });
    } catch (err) {
        if (conn) await conn.rollback().catch(() => { });
        await fotos.borrarFotos(urls);
        const categoriaInvalida = esCategoriaInvalida(err);
        if (!categoriaInvalida) console.error("❌ Error al publicar oferta:", err.message);
        res.status(categoriaInvalida ? 400 : 500).json({
            message: categoriaInvalida ? "La categoría elegida no existe." : "Error al guardar el material en la base de datos."
        });
    } finally {
        if (conn) conn.release();
    }
});

// EDITAR UNA PUBLICACIÓN (su dueño o el admin). Mismos campos que al publicar y, además:
//   fotosQuitar: direcciones de fotos actuales que se borran (JSON o campo repetido)
//   fotos:       fotos nuevas (multipart), hasta completar 5 en total
// Si la publicación tiene una subasta abierta, esta toma el título y la categoría nuevos
// (su precio no cambia: ya puede tener pujas).
app.put('/api/ofertas/:id', verificarToken, soloRoles('proveedor'), limites.fotos, fotos.recibirFotos, async (req, res) => {
    const ofertaId = enteroPositivo(req.params.id);
    const archivos = req.files || [];
    if (!ofertaId) return res.status(404).json({ message: "Esa publicación no existe o no es tuya." });
    const datos = validarOferta(req.body);
    if (datos.error) return res.status(400).json({ message: datos.error });
    const errorFotos = fotos.validarFotos(archivos);
    if (errorFotos) return res.status(400).json({ message: errorFotos });

    let quitar = req.body.fotosQuitar === undefined ? [] : req.body.fotosQuitar;
    if (typeof quitar === 'string') {
        try { quitar = quitar.trim().startsWith('[') ? JSON.parse(quitar) : [quitar]; } catch (e) { quitar = null; }
    }
    if (!Array.isArray(quitar) || !quitar.every(u => typeof u === 'string')) {
        return res.status(400).json({ message: "La lista de fotos a quitar no es válida." });
    }

    let urlsNuevas = [];
    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();
        const [[oferta]] = await conn.query(
            `SELECT OfertaID, Fotos FROM Ofertas WHERE OfertaID = ? ${req.usuario.esAdmin ? '' : 'AND ProveedorID = ?'} FOR UPDATE`,
            req.usuario.esAdmin ? [ofertaId] : [ofertaId, req.usuario.id]
        );
        if (!oferta) throw errorDeUsuario(404, "Esa publicación no existe o no es tuya.");

        const [filasFotos] = await conn.query('SELECT FotoID, FotoURL FROM FotosOfertas WHERE OfertaID = ?', [ofertaId]);
        // Fotos antiguas guardadas como texto (solo cuentan si no hay fotos en la tabla)
        const antiguas = filasFotos.length ? [] : leerFotosAntiguas(oferta.Fotos);
        const borradas = filasFotos.filter(f => quitar.includes(f.FotoURL));
        const antiguasQuedan = antiguas.filter(u => !quitar.includes(u));
        const totalFinal = filasFotos.length - borradas.length + antiguasQuedan.length + archivos.length;
        if (totalFinal > fotos.MAX_FOTOS) {
            throw errorDeUsuario(400, `Puedes tener como máximo ${fotos.MAX_FOTOS} fotos por publicación. Quita alguna antes de agregar más.`);
        }

        urlsNuevas = await fotos.guardarFotos(archivos);
        await conn.query(
            'UPDATE Ofertas SET TituloMaterial = ?, CategoriaID = ?, Precio = ?, UnidadMedida = ?, DistanciaSimuladaKm = ? WHERE OfertaID = ?',
            [datos.titulo, datos.categoriaId, datos.precio, datos.unidad, datos.distancia, ofertaId]
        );
        if (antiguasQuedan.length !== antiguas.length) {
            await conn.query('UPDATE Ofertas SET Fotos = ? WHERE OfertaID = ?', [JSON.stringify(antiguasQuedan), ofertaId]);
        }
        if (borradas.length) {
            await conn.query('DELETE FROM FotosOfertas WHERE FotoID IN (?)', [borradas.map(f => f.FotoID)]);
        }
        if (urlsNuevas.length) {
            await conn.query('INSERT INTO FotosOfertas (OfertaID, FotoURL, EsPrincipal) VALUES ?', [urlsNuevas.map(u => [ofertaId, u, 0])]);
        }
        // Si se quitó la foto principal, pasa a serlo la primera que queda
        const [[principal]] = await conn.query(
            'SELECT FotoID FROM FotosOfertas WHERE OfertaID = ? ORDER BY EsPrincipal DESC, FotoID LIMIT 1', [ofertaId]
        );
        if (principal) {
            await conn.query('UPDATE FotosOfertas SET EsPrincipal = (FotoID = ?) WHERE OfertaID = ?', [principal.FotoID, ofertaId]);
        }
        const [subasta] = await conn.query(
            "UPDATE Subastas SET TituloLote = ?, CategoriaID = ? WHERE OfertaID = ? AND Estado = 'Activa' AND FechaFin > NOW()",
            [`Lote Subasta: ${datos.titulo}`, datos.categoriaId, ofertaId]
        );
        await conn.commit();

        await fotos.borrarFotos(borradas.map(f => f.FotoURL));
        const fotosFinales = (await urlsDeFotos([ofertaId])).get(ofertaId) || antiguasQuedan;
        res.json({
            message: subasta.affectedRows > 0
                ? "Publicación actualizada. Su subasta abierta también muestra el título y la categoría nuevos."
                : "Publicación actualizada.",
            ofertaId,
            fotos: fotosFinales
        });
    } catch (err) {
        if (conn) await conn.rollback().catch(() => { });
        await fotos.borrarFotos(urlsNuevas);
        if (err.status) return res.status(err.status).json({ message: err.message });
        const categoriaInvalida = esCategoriaInvalida(err);
        if (!categoriaInvalida) console.error("❌ Error al editar oferta:", err.message);
        res.status(categoriaInvalida ? 400 : 500).json({
            message: categoriaInvalida ? "La categoría elegida no existe." : "No se pudo guardar la publicación."
        });
    } finally {
        if (conn) conn.release();
    }
});

// Borra una oferta con sus fotos (de la tabla y del disco) y cancela su subasta si sigue abierta.
// Si se indica proveedorId, solo la borra si es de ese proveedor, y NO la borra si su
// subasta abierta ya tiene pujas (no se le quita el lote a quien va ganando).
// El admin (sin proveedorId) sí puede: la subasta queda 'Cancelada' igual.
// Las subastas ya vencidas no se tocan: el cierre automático les da su ganador.
// Si la borra el admin (moderadorId) y la subasta tenía pujas, se avisa a quienes pujaron.
// Devuelve { borrada, pujas, subastasCanceladas, pujadoresAvisados }.
const MOTIVO_MODERACION = 'por moderación del administrador';
async function eliminarOferta(ofertaId, proveedorId = null, moderadorId = null) {
    const soloDelProveedor = proveedorId !== null;
    const conn = await db.promise().getConnection();
    let urlsFotos = [];
    let abiertas = [];
    let avisos = [];
    try {
        await conn.beginTransaction();
        const [[oferta]] = await conn.query(
            `SELECT OfertaID FROM Ofertas WHERE OfertaID = ? ${soloDelProveedor ? 'AND ProveedorID = ?' : ''} FOR UPDATE`,
            soloDelProveedor ? [ofertaId, proveedorId] : [ofertaId]
        );
        if (!oferta) {
            await conn.rollback();
            return { borrada: false, pujas: 0, subastasCanceladas: 0, pujadoresAvisados: 0 };
        }

        // FOR UPDATE: una puja que llegue mientras tanto espera y luego ve la subasta cancelada
        [abiertas] = await conn.query(
            `SELECT s.SubastaID, (SELECT COUNT(*) FROM Pujas p WHERE p.SubastaID = s.SubastaID) AS pujas
             FROM Subastas s
             WHERE s.OfertaID = ? AND s.Estado = 'Activa' AND s.FechaFin > NOW()
             FOR UPDATE`,
            [ofertaId]
        );
        const pujas = abiertas.reduce((total, s) => total + Number(s.pujas), 0);
        if (soloDelProveedor && pujas > 0) {
            await conn.rollback();
            return { borrada: false, pujas, subastasCanceladas: 0, pujadoresAvisados: 0 };
        }
        if (abiertas.length > 0) {
            await conn.query("UPDATE Subastas SET Estado = 'Cancelada' WHERE SubastaID IN (?)", [abiertas.map(s => s.SubastaID)]);
            if (moderadorId && pujas > 0) {
                avisos = await avisarPujadoresCancelacion(conn, {
                    subastaIds: abiertas.filter(s => Number(s.pujas) > 0).map(s => s.SubastaID),
                    remitenteId: moderadorId,
                    motivo: MOTIVO_MODERACION
                });
            }
        }

        const [filasFotos] = await conn.query('SELECT FotoURL FROM FotosOfertas WHERE OfertaID = ?', [ofertaId]);
        urlsFotos = filasFotos.map(f => f.FotoURL);
        // Las filas de FotosOfertas se borran en cascada; las subastas conservan su historial (OfertaID = NULL)
        await conn.query('DELETE FROM Ofertas WHERE OfertaID = ?', [ofertaId]);
        await conn.commit();
    } catch (err) {
        await conn.rollback().catch(() => { });
        throw err;
    } finally {
        conn.release();
    }
    await fotos.borrarFotos(urlsFotos);
    cierreSubastas.avisarCancelacionPorCorreo(avisos, MOTIVO_MODERACION)
        .catch(err => console.error('⚠️ Aviso de subasta cancelada no enviado:', err.message));
    const pujadoresAvisados = new Set(avisos.map(a => a.emprendedorId)).size;
    return { borrada: true, pujas: 0, subastasCanceladas: abiertas.length, pujadoresAvisados };
}

const mensajeOfertaBorrada = (resultado, base) => {
    let texto = base;
    if (resultado.subastasCanceladas > 0) texto += ' Su subasta abierta también se canceló.';
    if (resultado.pujadoresAvisados > 0) texto += ` Avisamos por el chat a ${resultado.pujadoresAvisados} persona(s) que habían pujado.`;
    return texto;
};

app.delete('/api/ofertas/:id', verificarToken, async (req, res) => {
    try {
        // Un proveedor solo puede borrar sus propias ofertas; el admin puede borrar cualquiera
        const resultado = req.usuario.esAdmin
            ? await eliminarOferta(req.params.id, null, req.usuario.id)
            : await eliminarOferta(req.params.id, req.usuario.id);
        if (resultado.pujas > 0) {
            return res.status(409).json({
                message: `Esta publicación tiene una subasta abierta con ${resultado.pujas} puja(s). Podrás borrarla cuando la subasta cierre.`,
                pujas: resultado.pujas
            });
        }
        if (!resultado.borrada) {
            return res.status(403).json({ message: "No tienes permiso para eliminar esta oferta o no existe." });
        }
        res.json({
            success: true,
            message: mensajeOfertaBorrada(resultado, "Oferta eliminada correctamente."),
            subastasCanceladas: resultado.subastasCanceladas,
            pujadoresAvisados: resultado.pujadoresAvisados
        });
    } catch (err) {
        console.error("❌ Error al eliminar oferta:", err.message);
        res.status(500).json({ message: "Error al remover la oferta." });
    }
});

// RUTAS PARA SUBASTAS Y PUJAS
// Solo las que siguen abiertas: una vencida desaparece de la lista aunque el
// cierre automático todavía no haya pasado por ella
// Cada una trae la foto principal y la categoría de su publicación. Primero las que cierran antes.
// Filtros opcionales: ?q=texto&categoria=ID. Con ?pagina=N&porPagina=M responde paginado.
app.get('/api/subastas', async (req, res) => {
    const pag = leerPaginacion(req.query, 10);
    const condiciones = ["s.Estado = 'Activa'", 's.FechaFin > NOW()'];
    const params = [];
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
        condiciones.push('s.TituloLote LIKE ?');
        params.push(patronLike(req.query.q));
    }
    const categoria = enteroPositivo(req.query.categoria);
    if (categoria) { condiciones.push('s.CategoriaID = ?'); params.push(categoria); }
    const where = 'WHERE ' + condiciones.join(' AND ');
    try {
        const [subastas] = await db.promise().query(`
            SELECT s.SubastaID, s.ProveedorID, s.OfertaID, s.CategoriaID, s.TituloLote, s.PrecioBase,
                   s.PrecioActual, s.FechaFin, s.Estado, c.NombreCategoria, o.Fotos AS FotosAntiguas,
                   (SELECT COUNT(*) FROM Pujas p WHERE p.SubastaID = s.SubastaID) AS TotalPujas
            FROM Subastas s
            LEFT JOIN CategoriasMateriales c ON c.CategoriaID = s.CategoriaID
            LEFT JOIN Ofertas o ON o.OfertaID = s.OfertaID
            ${where}
            ORDER BY s.FechaFin, s.SubastaID
            ${pag ? 'LIMIT ? OFFSET ?' : ''}
        `, pag ? [...params, pag.porPagina, pag.offset] : params);
        const fotosPorOferta = await urlsDeFotos([...new Set(subastas.map(s => s.OfertaID).filter(Boolean))]);
        const lista = subastas.map(({ FotosAntiguas, ...s }) => ({
            ...s,
            TotalPujas: Number(s.TotalPujas),
            Foto: (fotosPorOferta.get(s.OfertaID) || leerFotosAntiguas(FotosAntiguas))[0] || null
        }));
        if (!pag) return res.json(lista);
        const [[{ total }]] = await db.promise().query(`SELECT COUNT(*) AS total FROM Subastas s ${where}`, params);
        res.json(respuestaPaginada(lista, Number(total), pag));
    } catch (err) {
        console.error("❌ Error en GET /api/subastas:", err.message);
        res.status(500).json([]);
    }
});

// CREAR UNA SUBASTA desde el Mercado (botón "Crear Subasta"): proveedores (y el admin, como en las ofertas).
// Con ofertaId, el lote sale de una de sus publicaciones (toma su título, categoría y fotos);
// sin ofertaId, es un lote nuevo con título y categoría propios.
app.post('/api/subastas', verificarToken, soloRoles('proveedor'), async (req, res) => {
    const proveedorId = req.usuario.id;
    const ofertaId = req.body.ofertaId ? Number(req.body.ofertaId) : null;
    const precioBase = Number(req.body.precioBase);
    const dias = req.body.dias === undefined || req.body.dias === '' ? DIAS_SUBASTA.porDefecto : Number(req.body.dias);
    let titulo = typeof req.body.tituloLote === 'string' ? req.body.tituloLote.trim() : '';
    let categoriaId = Number(req.body.categoriaId) || null;

    if (!(precioBase > 0) || precioBase > PRECIO_MAXIMO) {
        return res.status(400).json({ message: "El precio base debe ser un número mayor que 0." });
    }
    if (!Number.isInteger(dias) || dias < DIAS_SUBASTA.minimo || dias > DIAS_SUBASTA.maximo) {
        return res.status(400).json({ message: `La subasta debe durar de ${DIAS_SUBASTA.minimo} a ${DIAS_SUBASTA.maximo} días.` });
    }
    if (ofertaId !== null && !(Number.isInteger(ofertaId) && ofertaId > 0)) {
        return res.status(400).json({ message: "La publicación elegida no es válida." });
    }

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        if (ofertaId) {
            // FOR UPDATE: dos clics seguidos no pueden abrir dos subastas de la misma publicación
            const [[oferta]] = await conn.query(
                'SELECT TituloMaterial, CategoriaID FROM Ofertas WHERE OfertaID = ? AND ProveedorID = ? FOR UPDATE',
                [ofertaId, proveedorId]
            );
            if (!oferta) throw errorDeUsuario(404, "Esa publicación no existe o no es tuya.");
            const [[abierta]] = await conn.query(
                "SELECT SubastaID FROM Subastas WHERE OfertaID = ? AND Estado = 'Activa' AND FechaFin > NOW() LIMIT 1",
                [ofertaId]
            );
            if (abierta) throw errorDeUsuario(409, "Esa publicación ya tiene una subasta abierta.");
            titulo = titulo || oferta.TituloMaterial;
            categoriaId = oferta.CategoriaID;
        }

        if (!titulo || !categoriaId) throw errorDeUsuario(400, "Escribe el título del lote y elige una categoría.");
        if (titulo.length > 120) throw errorDeUsuario(400, "El título puede tener como máximo 120 caracteres.");

        const { subastaId, fechaFin } = await insertarSubasta(conn, { proveedorId, ofertaId, categoriaId, titulo, precioBase, dias });
        await conn.commit();
        res.status(201).json({
            message: `¡Subasta creada! Recibirá pujas durante ${dias} día${dias === 1 ? '' : 's'}.`,
            subastaId,
            fechaFin
        });
    } catch (err) {
        if (conn) await conn.rollback().catch(() => { });
        if (err.status) return res.status(err.status).json({ message: err.message });
        const categoriaInvalida = err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW';
        if (!categoriaInvalida) console.error("❌ Error al crear subasta:", err.message);
        res.status(categoriaInvalida ? 400 : 500).json({
            message: categoriaInvalida ? "La categoría elegida no existe." : "No se pudo crear la subasta."
        });
    } finally {
        if (conn) conn.release();
    }
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
                if (s.Estado === 'Cancelada') {
                    return res.status(409).json({ message: "Esta subasta fue cancelada porque el proveedor retiró la publicación." });
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
    // Se excluye al propio usuario de su lista de contactos.
    // Primero los que tienen mensajes sin leer, luego las conversaciones más recientes.
    const yo = req.usuario.id;
    const query = `
        SELECT
            p.UsuarioID,
            p.NombreRazonSocial,
            COALESCE(u.TipoRol, 'Usuario') AS TipoRol,
            COALESCE(d.NombreDepartamento, 'Nicaragua') AS NombreDepartamento,
            (SELECT COUNT(*) FROM MensajesChat m
              WHERE m.RemitenteID = p.UsuarioID AND m.DestinatarioID = ? AND m.EsLeido = 0) AS NoLeidos,
            (SELECT MAX(m.FechaEnvio) FROM MensajesChat m
              WHERE (m.RemitenteID = p.UsuarioID AND m.DestinatarioID = ?)
                 OR (m.RemitenteID = ? AND m.DestinatarioID = p.UsuarioID)) AS UltimoMensaje
        FROM PerfilesUsuarios p
        LEFT JOIN Usuarios u ON p.UsuarioID = u.UsuarioID
        LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
        WHERE p.UsuarioID <> ?
        ORDER BY NoLeidos > 0 DESC, UltimoMensaje IS NULL, UltimoMensaje DESC, p.NombreRazonSocial
    `;

    db.query(query, [yo, yo, yo, yo], (err, results) => {
        if (err) return res.status(500).json([]);
        res.json((results || []).map(c => ({ ...c, NoLeidos: Number(c.NoLeidos) })));
    });
});

// MENSAJES NO LEÍDOS: total y por contacto (el menú de todas las páginas lo consulta cada 30 s)
app.get('/api/chat/no-leidos', verificarToken, async (req, res) => {
    try {
        const [filas] = await db.promise().query(
            'SELECT RemitenteID, COUNT(*) AS n FROM MensajesChat WHERE DestinatarioID = ? AND EsLeido = 0 GROUP BY RemitenteID',
            [req.usuario.id]
        );
        const porContacto = Object.fromEntries(filas.map(f => [f.RemitenteID, Number(f.n)]));
        res.json({ total: filas.reduce((suma, f) => suma + Number(f.n), 0), porContacto });
    } catch (err) {
        console.error('❌ Error en GET /api/chat/no-leidos:', err.message);
        res.status(500).json({ total: 0, porContacto: {} });
    }
});

app.get('/api/chat/mensajes', verificarToken, (req, res) => {
    // Solo se pueden leer conversaciones en las que participa el usuario de la sesión
    const remitenteId = req.usuario.id;
    const { destinatarioId } = req.query;

    if (!destinatarioId) {
        return res.status(400).json({ message: "Faltan identificadores de usuario." });
    }

    const query = `
        SELECT MensajeID, RemitenteID, DestinatarioID, ContenidoTexto, FechaEnvio, EsLeido
        FROM MensajesChat
        WHERE (RemitenteID = ? AND DestinatarioID = ?)
           OR (RemitenteID = ? AND DestinatarioID = ?)
        ORDER BY FechaEnvio ASC, MensajeID ASC
    `;

    // Abrir la conversación marca como leídos los mensajes que me envió esa persona
    const marcarLeidos = `
        UPDATE MensajesChat SET EsLeido = 1, FechaLectura = NOW()
        WHERE RemitenteID = ? AND DestinatarioID = ? AND EsLeido = 0
    `;

    db.query(marcarLeidos, [destinatarioId, remitenteId], (errLeidos) => {
        if (errLeidos) console.error('⚠️ No se pudieron marcar los mensajes como leídos:', errLeidos.message);
        db.query(query, [remitenteId, destinatarioId, destinatarioId, remitenteId], (err, results) => {
            if (err) return res.status(500).json([]);
            res.json((results || []).map(m => ({ ...m, EsLeido: !!m.EsLeido })));
        });
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
            (SELECT COUNT(*) FROM MensajesChat) AS totalMensajes,
            (SELECT COUNT(*) FROM Usuarios WHERE CorreoElectronico NOT REGEXP ?) AS correosInvalidos,
            (SELECT COUNT(*) FROM Usuarios WHERE CorreoVerificado = 0) AS cuentasSinVerificar
    `;

    db.query(sqlMetricas, [REGEXP_EMAIL_SQL], (err, results) => {
        if (err) {
            console.error("❌ Error al obtener métricas de admin:", err.message);
            return res.status(500).json({ message: "Error al consultar métricas del sistema." });
        }
        res.json(results[0] || {});
    });
});

// 2. LISTAR LOS USUARIOS DEL SISTEMA CON DETALLES
// ?buscar=texto (nombre o correo), ?problemas=1 (correo inválido o sin confirmar),
// ?pagina=N&porPagina=M para paginar (sin ?pagina devuelve la lista completa).
app.get('/api/admin/usuarios', verificarAdmin, async (req, res) => {
    const pag = leerPaginacion(req.query, 20, 100);
    const condiciones = [];
    const params = [];
    if (typeof req.query.buscar === 'string' && req.query.buscar.trim()) {
        condiciones.push('(u.CorreoElectronico LIKE ? OR p.NombreRazonSocial LIKE ?)');
        params.push(patronLike(req.query.buscar), patronLike(req.query.buscar));
    }
    if (req.query.problemas === '1') {
        condiciones.push('(u.CorreoVerificado = 0 OR u.CorreoElectronico NOT REGEXP ?)');
        params.push(REGEXP_EMAIL_SQL);
    }
    const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
    const desde = `
        FROM Usuarios u
        LEFT JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
        LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
        ${where}`;

    try {
        const [filas] = await db.promise().query(`
            SELECT
                u.UsuarioID,
                u.CorreoElectronico,
                u.TipoRol,
                COALESCE(u.EstadoCuenta, 'Activo') AS EstadoCuenta,
                u.FechaRegistro AS FechaCreacion,
                u.CorreoVerificado,
                p.NombreRazonSocial,
                p.TelefonoWhatsApp,
                d.NombreDepartamento
            ${desde}
            ORDER BY u.UsuarioID DESC
            ${pag ? 'LIMIT ? OFFSET ?' : ''}
        `, pag ? [...params, pag.porPagina, pag.offset] : params);
        // CorreoValido = false: el correo no tiene dominio completo (p. ej. "erick@gmail") y no puede iniciar sesión
        const lista = filas.map(u => ({ ...u, CorreoVerificado: !!u.CorreoVerificado, CorreoValido: REGEX_EMAIL.test(u.CorreoElectronico || '') }));
        if (!pag) return res.json(lista);
        const [[{ total }]] = await db.promise().query(`SELECT COUNT(*) AS total ${desde}`, params);
        res.json(respuestaPaginada(lista, Number(total), pag));
    } catch (err) {
        console.error("❌ Error al listar usuarios:", err.message);
        res.status(500).json({ message: "Error al obtener lista de usuarios." });
    }
});

// 2b. CORREGIR EL CORREO DE UNA CUENTA (p. ej. "erick@gmail" sin ".com", que no puede entrar).
// El administrador lo confirma con la persona, así que la cuenta queda verificada.
app.put('/api/admin/usuarios/:id/correo', verificarAdmin, async (req, res) => {
    const usuarioId = enteroPositivo(req.params.id);
    const correoNuevo = typeof req.body.correo === 'string' ? req.body.correo.trim() : '';
    if (!REGEX_EMAIL.test(correoNuevo) || correoNuevo.length > 100) {
        return res.status(400).json({ message: "Escribe un correo válido con su dominio completo (ejemplo: usuario@gmail.com)." });
    }
    if (!usuarioId) return res.status(404).json({ message: "Usuario no encontrado." });
    try {
        const [resultado] = await db.promise().query(
            `UPDATE Usuarios SET CorreoElectronico = ?, CorreoVerificado = 1, TokenVerificacion = NULL, ExpiracionVerificacion = NULL
             WHERE UsuarioID = ?`,
            [correoNuevo, usuarioId]
        );
        if (resultado.affectedRows === 0) return res.status(404).json({ message: "Usuario no encontrado." });
        res.json({ success: true, message: `Correo actualizado a ${correoNuevo}. La persona ya puede iniciar sesión con él.` });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: "Ese correo ya lo usa otra cuenta." });
        console.error("❌ Error al corregir correo:", err.message);
        res.status(500).json({ message: "No se pudo actualizar el correo." });
    }
});

// 2c. DAR POR CONFIRMADO EL CORREO DE UNA CUENTA (si no le llega el enlace)
app.put('/api/admin/usuarios/:id/verificar', verificarAdmin, async (req, res) => {
    const usuarioId = enteroPositivo(req.params.id);
    if (!usuarioId) return res.status(404).json({ message: "Usuario no encontrado." });
    try {
        const [resultado] = await db.promise().query(
            'UPDATE Usuarios SET CorreoVerificado = 1, TokenVerificacion = NULL, ExpiracionVerificacion = NULL WHERE UsuarioID = ?',
            [usuarioId]
        );
        if (resultado.affectedRows === 0) return res.status(404).json({ message: "Usuario no encontrado." });
        res.json({ success: true, message: "Correo marcado como confirmado. La cuenta ya puede iniciar sesión." });
    } catch (err) {
        console.error("❌ Error al verificar cuenta:", err.message);
        res.status(500).json({ message: "No se pudo actualizar la cuenta." });
    }
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
const MOTIVO_BAJA = 'porque la cuenta del proveedor fue dada de baja';
app.delete('/api/admin/usuarios/:id', verificarAdmin, async (req, res) => {
    const usuarioIdTarget = Number(req.params.id);

    if (usuarioIdTarget === req.usuario.id) {
        return res.status(400).json({ message: "No puedes eliminar tu propia cuenta de administrador." });
    }
    if (!enteroPositivo(usuarioIdTarget)) {
        return res.status(404).json({ message: "El usuario a eliminar no existe." });
    }

    // Ofertas, Subastas, Pujas, MensajesChat y TratosCerrados apuntan al usuario SIN
    // "ON DELETE CASCADE", así que MySQL no deja borrarlo directamente.
    // Se eliminan primero sus registros, todo dentro de una transacción
    // (si algo falla no se borra nada).
    const pasos = [
        ['DELETE FROM Calificaciones WHERE AutorID = ? OR CalificadoID = ?', [usuarioIdTarget, usuarioIdTarget]],
        ['DELETE FROM MensajesChat WHERE RemitenteID = ? OR DestinatarioID = ?', [usuarioIdTarget, usuarioIdTarget]],
        ['DELETE FROM TratosCerrados WHERE ProveedorID = ? OR EmprendedorID = ?', [usuarioIdTarget, usuarioIdTarget]],
        ['DELETE FROM Pujas WHERE EmprendedorID = ?', [usuarioIdTarget]],
        ['DELETE FROM Subastas WHERE ProveedorID = ?', [usuarioIdTarget]],   // sus pujas se borran en cascada
        ['DELETE FROM Ofertas WHERE ProveedorID = ?', [usuarioIdTarget]],    // sus fotos se borran en cascada
        ['DELETE FROM Usuarios WHERE UsuarioID = ?', [usuarioIdTarget]]      // perfil, roles, etc. en cascada
    ];

    let conn;
    let urlsFotos = [];
    let avisos = [];
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();
        const [[existe]] = await conn.query('SELECT UsuarioID FROM Usuarios WHERE UsuarioID = ? FOR UPDATE', [usuarioIdTarget]);
        if (!existe) throw errorDeUsuario(404, "El usuario a eliminar no existe.");

        // Las fotos de sus ofertas se anotan antes, para borrar los archivos al final
        const [filasFotos] = await conn.query(
            'SELECT f.FotoURL FROM FotosOfertas f JOIN Ofertas o ON o.OfertaID = f.OfertaID WHERE o.ProveedorID = ?',
            [usuarioIdTarget]
        );
        urlsFotos = filasFotos.map(f => f.FotoURL);

        // Sus subastas abiertas desaparecen: se avisa por el chat a quienes habían pujado
        const [abiertas] = await conn.query(
            "SELECT SubastaID FROM Subastas WHERE ProveedorID = ? AND Estado = 'Activa' AND FechaFin > NOW()",
            [usuarioIdTarget]
        );
        avisos = await avisarPujadoresCancelacion(conn, {
            subastaIds: abiertas.map(s => s.SubastaID),
            remitenteId: req.usuario.id,
            motivo: MOTIVO_BAJA
        });

        for (const [sql, params] of pasos) await conn.query(sql, params);
        await conn.commit();
    } catch (err) {
        if (conn) await conn.rollback().catch(() => { });
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error("❌ Error al eliminar usuario:", err.message);
        return res.status(500).json({ message: "Error al eliminar usuario del sistema." });
    } finally {
        if (conn) conn.release();
    }

    await fotos.borrarFotos(urlsFotos);
    cierreSubastas.avisarCancelacionPorCorreo(avisos, MOTIVO_BAJA)
        .catch(err => console.error('⚠️ Aviso de subasta cancelada no enviado:', err.message));
    const pujadoresAvisados = new Set(avisos.map(a => a.emprendedorId)).size;
    res.json({
        success: true,
        message: "Usuario y sus registros asociados eliminados correctamente." +
            (pujadoresAvisados ? ` Avisamos por el chat a ${pujadoresAvisados} persona(s) que habían pujado en sus subastas.` : ''),
        pujadoresAvisados
    });
});

// 5. MODERACIÓN DE CONTENIDO: ELIMINAR CUALQUIER OFERTA POR ADMIN
app.delete('/api/admin/ofertas/:id', verificarAdmin, async (req, res) => {
    try {
        const resultado = await eliminarOferta(req.params.id, null, req.usuario.id);
        if (!resultado.borrada) {
            return res.status(404).json({ message: "La oferta no existe o ya fue eliminada." });
        }
        res.json({
            success: true,
            message: mensajeOfertaBorrada(resultado, "Publicación eliminada por moderación administrativa."),
            subastasCanceladas: resultado.subastasCanceladas,
            pujadoresAvisados: resultado.pujadoresAvisados
        });
    } catch (err) {
        console.error("❌ Error al moderar oferta:", err.message);
        res.status(500).json({ message: "Error al eliminar la publicación." });
    }
});

// 6b. CERRAR AHORA LAS SUBASTAS VENCIDAS (normalmente lo hace solo cada minuto)
app.post('/api/admin/subastas/cerrar-vencidas', verificarAdmin, async (req, res) => {
    try {
        const cerradas = await cierreSubastas.cerrarVencidas();
        res.json({
            message: cerradas.length ? `Se cerraron ${cerradas.length} subasta(s) vencida(s).` : 'No había subastas vencidas por cerrar.',
            cerradas
        });
    } catch (err) {
        console.error('❌ Error al cerrar subastas:', err.message);
        res.status(500).json({ message: 'No se pudieron cerrar las subastas vencidas.' });
    }
});

// MIS TRATOS: subastas que gané (emprendedor) o que vendí (proveedor).
// Primero los que siguen abiertos (pendiente / en proceso), luego los más recientes.
app.get('/api/tratos', verificarToken, async (req, res) => {
    try {
        const [filas] = await db.promise().query(`
            SELECT t.TratoID AS id, t.TipoOrigen AS origen, t.OrigenID AS origenId,
                   t.DescripcionResumen AS descripcion, t.MontoTotal AS monto,
                   t.EstadoTrato AS estado, t.FechaCierre AS fecha,
                   (t.ProveedorID = ?) AS soyProveedor,
                   IF(t.ProveedorID = ?, t.EmprendedorID, t.ProveedorID) AS contraparteId,
                   COALESCE(p.NombreRazonSocial, 'Usuario') AS contraparte,
                   (SELECT c.Puntuacion FROM Calificaciones c WHERE c.TratoID = t.TratoID AND c.AutorID = ?) AS miCalificacion,
                   (SELECT c.Puntuacion FROM Calificaciones c WHERE c.TratoID = t.TratoID AND c.AutorID <> ?) AS suCalificacion
            FROM TratosCerrados t
            LEFT JOIN PerfilesUsuarios p ON p.UsuarioID = IF(t.ProveedorID = ?, t.EmprendedorID, t.ProveedorID)
            WHERE t.ProveedorID = ? OR t.EmprendedorID = ?
            ORDER BY (t.EstadoTrato IN ('Pendiente', 'EnProceso')) DESC, t.FechaCierre DESC, t.TratoID DESC
            LIMIT 50
        `, Array(7).fill(req.usuario.id));
        res.json(filas.map(t => ({ ...t, monto: Number(t.monto), soyProveedor: !!t.soyProveedor })));
    } catch (err) {
        console.error('❌ Error en GET /api/tratos:', err.message);
        res.status(500).json({ message: 'No se pudieron cargar tus tratos.' });
    }
});

// CAMBIAR EL ESTADO DE UN TRATO: { estado: 'EnProceso' | 'Completado' | 'Cancelado', motivo? }
// Solo el proveedor o el comprador del trato (ver reglas en tratos.js)
const MENSAJES_ESTADO_TRATO = {
    EnProceso: 'Trato marcado como en proceso.',
    Completado: '¡Trato completado!',
    Cancelado: 'Trato cancelado.'
};
app.put('/api/tratos/:id/estado', verificarToken, async (req, res) => {
    try {
        const resultado = await tratos.cambiarEstado({
            tratoId: Number(req.params.id),
            usuarioId: req.usuario.id,
            estado: req.body.estado,
            motivo: req.body.motivo
        });
        res.json({ message: `${MENSAJES_ESTADO_TRATO[resultado.estado]} Le avisamos a la otra parte por el chat.`, ...resultado });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error('❌ Error al cambiar el estado del trato:', err.message);
        res.status(500).json({ message: 'No se pudo actualizar el trato.' });
    }
});

// CALIFICAR UN TRATO COMPLETADO: { puntuacion: 1..5, comentario? } (ver tratos.js)
app.post('/api/tratos/:id/calificacion', verificarToken, async (req, res) => {
    try {
        const resultado = await tratos.calificar({
            tratoId: Number(req.params.id),
            usuarioId: req.usuario.id,
            puntuacion: req.body.puntuacion,
            comentario: req.body.comentario
        });
        res.status(201).json({ message: '¡Gracias por calificar! Le avisamos a la otra parte por el chat.', ...resultado });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error('❌ Error al calificar el trato:', err.message);
        res.status(500).json({ message: 'No se pudo guardar la calificación.' });
    }
});

// REPUTACIÓN DE UN USUARIO: promedio, total y últimas calificaciones recibidas
app.get('/api/usuarios/:id/reputacion', verificarToken, async (req, res) => {
    const usuarioId = enteroPositivo(req.params.id);
    if (!usuarioId) return res.status(404).json({ message: 'Usuario no encontrado.' });
    try {
        res.json(await tratos.reputacion(usuarioId));
    } catch (err) {
        console.error('❌ Error en reputación:', err.message);
        res.status(500).json({ message: 'No se pudo consultar la reputación.' });
    }
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
                (SELECT COUNT(*) FROM Subastas WHERE Estado = 'Finalizada' OR (Estado = 'Activa' AND FechaFin <= NOW())) AS subastasCerradas,
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
                    (SELECT COUNT(*) FROM MensajesChat WHERE DestinatarioID = ?) AS mensajesRecibidos,
                    (SELECT COUNT(*) FROM TratosCerrados WHERE ProveedorID = ? AND TipoOrigen = 'Subasta' AND EstadoTrato <> 'Cancelado') AS subastasVendidas,
                    (SELECT COALESCE(SUM(MontoTotal), 0) FROM TratosCerrados WHERE ProveedorID = ? AND TipoOrigen = 'Subasta' AND EstadoTrato <> 'Cancelado') AS montoVendido
            `, [yo, yo, yo, yo, yo, yo, yo]);
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
                    (SELECT COUNT(*) FROM MensajesChat WHERE DestinatarioID = ?) AS mensajesRecibidos,
                    (SELECT COUNT(*) FROM TratosCerrados WHERE EmprendedorID = ? AND TipoOrigen = 'Subasta' AND EstadoTrato <> 'Cancelado') AS subastasGanadas,
                    (SELECT COALESCE(SUM(MontoTotal), 0) FROM TratosCerrados WHERE EmprendedorID = ? AND TipoOrigen = 'Subasta' AND EstadoTrato <> 'Cancelado') AS montoGanado
            `, [yo, yo, yo, yo, yo, yo, yo]);
            miActividad = { ...miActividad, ...m };
        }

        // Calificación que me dieron en mis tratos completados
        if (req.usuario.rol === 'proveedor' || req.usuario.rol === 'emprendedor') {
            const [cal] = await q('SELECT COUNT(*) AS total, AVG(Puntuacion) AS promedio FROM Calificaciones WHERE CalificadoID = ?', [yo]);
            miActividad.misCalificaciones = Number(cal.total);
            miActividad.miCalificacion = cal.promedio === null ? null : Math.round(Number(cal.promedio) * 10) / 10;
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

// Fotos subidas por los proveedores (fuera de public/ y fuera de git, ver fotos.js).
// Los nombres son aleatorios y nunca cambian, así que el navegador puede guardarlas en caché.
app.use('/uploads', express.static(fotos.CARPETA_UPLOADS, {
    index: false,
    dotfiles: 'deny',
    maxAge: '30d',
    immutable: true,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));

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