// ==========================================================================
// CUENTAS: registro, inicio de sesión, recuperación de contraseña y
// confirmación del correo.
//   POST /registro
//   POST /api/login
//   POST /api/solicitar-recuperacion      GET /api/validar-token-recuperacion
//   POST /api/restablecer-password
//   GET  /api/verificar-correo            POST /api/reenviar-verificacion
// ==========================================================================
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const limites = require('../middlewares/limites');
const { enTransaccion } = require('../db');
const { ErrorHttp, REGEX_EMAIL, esTokenValido, textoLimpio, ocultarCorreo } = require('../utilidades');

const MENSAJE_RECUPERACION = "Si el correo está registrado, recibirás un enlace de recuperación en unos minutos.";
const MENSAJE_REENVIO = "Si la cuenta existe y falta confirmarla, te enviamos un enlace nuevo. Revisa también la carpeta Spam.";
const ESPERA_REENVIO_MS = 60 * 1000;                     // 1 correo por minuto por dirección
const VIGENCIA_RECUPERACION_MS = 60 * 60 * 1000;         // el enlace de recuperación vale 1 hora
const VIGENCIA_VERIFICACION_MS = 24 * 60 * 60 * 1000;    // el de confirmación, 24 horas
const LARGO_MAXIMO_BCRYPT = 72;                          // bcrypt ignora lo que pase de 72 bytes

const nuevoToken = () => crypto.randomBytes(32).toString('hex');
const esHashBcrypt = (hash) => /^\$2[aby]\$/.test(hash);

function crearRutasCuentas({ db, correo, firmarToken, rondasBcrypt, verificarCorreo, urlPublica }) {
    const router = express.Router();

    // Recuerda cuándo se mandó el último correo a cada dirección (1 por minuto).
    // Devuelve false si todavía no pasó el minuto.
    const ultimosEnvios = new Map();
    function puedeEnviar(clave) {
        const ahora = Date.now();
        if (ultimosEnvios.has(clave) && ahora - ultimosEnvios.get(clave) < ESPERA_REENVIO_MS) return false;
        ultimosEnvios.set(clave, ahora);
        if (ultimosEnvios.size > 1000) {
            for (const [c, t] of ultimosEnvios) if (ahora - t > ESPERA_REENVIO_MS) ultimosEnvios.delete(c);
        }
        return true;
    }

    // Manda el enlace de confirmación (o lo escribe en el log si el correo no está configurado).
    // No bloquea la respuesta: el resultado del envío queda en el log.
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

    // ---------------------------------------------------------------- REGISTRO
    router.post('/registro', limites.registro, async (req, res) => {
        const b = req.body;
        const nombreDepartamento = textoLimpio(b.deptoId);
        const passwordPlano = b.password || b.contrasena;
        const emailLimpio = textoLimpio(b.email);
        const rol = String(b.rol || '');

        if (!nombreDepartamento || !emailLimpio || !b.nombre || !rol || !passwordPlano) {
            throw new ErrorHttp(400, "Por favor, completa todos los campos obligatorios.");
        }
        if (typeof passwordPlano !== 'string' || passwordPlano.length < 6) {
            throw new ErrorHttp(400, "La contraseña debe tener al menos 6 caracteres.");
        }
        // Solo se permite registrarse como Proveedor o Emprendedor (nunca como administrador)
        const rolMinus = rol.toLowerCase();
        if (!['proveedor', 'emprendedor'].includes(rolMinus)) {
            throw new ErrorHttp(400, "Rol no válido.");
        }
        if (!REGEX_EMAIL.test(emailLimpio)) {
            throw new ErrorHttp(400, "El correo electrónico no es válido. Debe incluir el dominio completo (ejemplo: usuario@gmail.com).");
        }

        // La contraseña se guarda cifrada con bcrypt, nunca en texto plano
        const passwordHash = await bcrypt.hash(passwordPlano, rondasBcrypt);
        // Si hay que confirmar el correo, la cuenta nace sin verificar y con un enlace de 24 h
        const tokenVerificacion = verificarCorreo ? nuevoToken() : null;

        try {
            await enTransaccion(db, async (conn) => {
                // El departamento se crea si todavía no existe
                const [[depto]] = await conn.query('SELECT DepartamentoID FROM Departamentos WHERE NombreDepartamento = ?', [nombreDepartamento]);
                const departamentoId = depto
                    ? depto.DepartamentoID
                    : (await conn.query('INSERT INTO Departamentos (NombreDepartamento) VALUES (?)', [nombreDepartamento]))[0].insertId;

                const [usuario] = await conn.query(
                    `INSERT INTO Usuarios (CorreoElectronico, ContrasenaHash, TipoRol, EstadoCuenta,
                                           CorreoVerificado, TokenVerificacion, ExpiracionVerificacion)
                     VALUES (?, ?, ?, 'Activo', ?, ?, ?)`,
                    [emailLimpio, passwordHash, rol, verificarCorreo ? 0 : 1, tokenVerificacion,
                        verificarCorreo ? new Date(Date.now() + VIGENCIA_VERIFICACION_MS) : null]
                ).catch((err) => {
                    if (err.code === 'ER_DUP_ENTRY') throw new ErrorHttp(500, "El correo ya está registrado o hubo un error.");
                    throw err;
                });
                const usuarioId = usuario.insertId;

                await conn.query(
                    'INSERT INTO PerfilesUsuarios (UsuarioID, NombreRazonSocial, TelefonoWhatsApp, DepartamentoID) VALUES (?, ?, ?, ?)',
                    [usuarioId, b.nombre, b.telefono || '', departamentoId]
                );

                if (rolMinus === 'proveedor') {
                    await conn.query(
                        `INSERT INTO Proveedores (UsuarioID, NumeroRUC, NombreComercial, TipoMateriaPrimaPrincipal, DescripcionEmpresa)
                         VALUES (?, ?, ?, ?, ?)`,
                        [usuarioId, b.numeroRuc || null, b.nombreComercial || b.nombre, b.tipoMateriaPrimaPrincipal || null, b.descripcionEmpresa || null]
                    );
                } else {
                    await conn.query(
                        `INSERT INTO Emprendedores (UsuarioID, NombreMarca, EspecialidadCalzado, CapacidadProduccionMensual)
                         VALUES (?, ?, ?, ?)`,
                        [usuarioId, b.nombreMarca || b.nombre, b.especialidadCalzado || null,
                            b.capacidadProduccionMensual ? parseInt(b.capacidadProduccionMensual, 10) : null]
                    );
                }
            });
        } catch (err) {
            if (err instanceof ErrorHttp) throw err;
            console.error('❌ Error en el registro:', err.message);
            throw new ErrorHttp(500, "El correo ya está registrado o hubo un error.");
        }

        if (!verificarCorreo) {
            return res.json({ message: "¡Registro exitoso en la plataforma!" });
        }
        enviarEnlaceVerificacion(emailLimpio, tokenVerificacion, urlPublica(req));
        res.json({
            message: `¡Registro exitoso! Te enviamos un correo a ${emailLimpio} para confirmar tu cuenta. Abre el enlace antes de iniciar sesión.`,
            verificacionPendiente: true
        });
    });

    // ----------------------------------------------------------- INICIO DE SESIÓN
    router.post('/api/login', limites.login, async (req, res) => {
        const emailLimpio = textoLimpio(req.body.email);
        const passIngresada = req.body.password || req.body.contrasena;

        if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
            throw new ErrorHttp(400, "Ingresa un correo electrónico válido.");
        }
        if (!passIngresada) {
            throw new ErrorHttp(400, "Ingresa tu contraseña.");
        }

        const [[usuario]] = await db.query(`
            SELECT u.UsuarioID, u.ContrasenaHash, u.TipoRol, u.EstadoCuenta, u.CorreoVerificado, p.NombreRazonSocial, d.NombreDepartamento
            FROM Usuarios u
            LEFT JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
            LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
            WHERE u.CorreoElectronico = ?
        `, [emailLimpio]);

        const incorrecto = new ErrorHttp(401, "Correo o contraseña incorrectos.");
        if (!usuario) throw incorrecto;

        const hashGuardado = usuario.ContrasenaHash || '';
        const cifrada = esHashBcrypt(hashGuardado);
        // Compatibilidad: las cuentas antiguas tienen la contraseña en texto plano.
        // Si coincide, se cifra con bcrypt en ese momento (migración automática).
        const coincide = cifrada
            ? await bcrypt.compare(String(passIngresada), hashGuardado)
            : hashGuardado === String(passIngresada);
        if (!coincide) throw incorrecto;

        if ((usuario.EstadoCuenta || '').toLowerCase() === 'suspendido') {
            throw new ErrorHttp(403, "Tu cuenta ha sido suspendida por el administrador.");
        }

        if (!cifrada) {
            bcrypt.hash(String(passIngresada), rondasBcrypt)
                .then((nuevoHash) => db.query('UPDATE Usuarios SET ContrasenaHash = ? WHERE UsuarioID = ?', [nuevoHash, usuario.UsuarioID]))
                .catch((err) => console.error('⚠️ No se pudo migrar la contraseña a bcrypt:', err.message));
        }

        // Cuenta nueva que todavía no abrió el enlace de confirmación
        if (Number(usuario.CorreoVerificado) === 0) {
            throw new ErrorHttp(403,
                "Antes de entrar, confirma tu correo: abre el enlace que te enviamos al registrarte. Si no te llegó (revisa también Spam), pide otro aquí.",
                { verificacionPendiente: true });
        }

        res.json({
            id: usuario.UsuarioID,
            nombre: usuario.NombreRazonSocial || 'Usuario',
            rol: usuario.TipoRol,
            departamento: usuario.NombreDepartamento || 'Managua',
            estado: usuario.EstadoCuenta || 'Activo',
            token: firmarToken(usuario)
        });
    });

    // ------------------------------------------------- RECUPERACIÓN DE CONTRASEÑA
    router.post('/api/solicitar-recuperacion', limites.recuperacion, async (req, res) => {
        const emailLimpio = textoLimpio(req.body.email);
        if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
            throw new ErrorHttp(400, "Por favor proporciona un correo electrónico válido.");
        }

        // Siempre se responde lo mismo, exista o no la cuenta, para no revelar qué correos están registrados
        if (!puedeEnviar(emailLimpio.toLowerCase())) return res.json({ message: MENSAJE_RECUPERACION });

        const [[usuario]] = await db.query(
            "SELECT UsuarioID, CorreoElectronico FROM Usuarios WHERE CorreoElectronico = ? AND (EstadoCuenta IS NULL OR EstadoCuenta <> 'Suspendido')",
            [emailLimpio]
        );
        if (!usuario) return res.json({ message: MENSAJE_RECUPERACION });

        const token = nuevoToken();
        await db.query(
            'UPDATE Usuarios SET TokenRecuperacion = ?, ExpiracionToken = ? WHERE UsuarioID = ?',
            [token, new Date(Date.now() + VIGENCIA_RECUPERACION_MS), usuario.UsuarioID]
        );

        const base = urlPublica(req);
        const enlace = `${base}/restablecer.html?token=${token}`;
        if (!correo.configurado) {
            console.warn(`🔑 Enlace de recuperación para ${emailLimpio} (correo no configurado): ${enlace}`);
        } else {
            // Se responde sin esperar al envío; el resultado queda en el log
            correo.enviarRecuperacion(usuario.CorreoElectronico, enlace, base)
                .then(() => console.log(`📧 Correo de recuperación enviado a ${emailLimpio}`))
                .catch((err) => console.error(`❌ No se pudo enviar el correo de recuperación a ${emailLimpio}: ${err.message}`));
        }
        res.json({ message: MENSAJE_RECUPERACION });
    });

    // Permite a restablecer.html saber, antes de escribir la contraseña, si el enlace sigue vigente
    router.get('/api/validar-token-recuperacion', async (req, res) => {
        if (!esTokenValido(req.query.token)) return res.status(400).json({ valido: false });
        const [[fila]] = await db.query(
            'SELECT CorreoElectronico, ExpiracionToken FROM Usuarios WHERE TokenRecuperacion = ? AND ExpiracionToken > NOW()',
            [req.query.token]
        );
        if (!fila) return res.status(400).json({ valido: false });
        res.json({ valido: true, correo: ocultarCorreo(fila.CorreoElectronico), expira: fila.ExpiracionToken });
    });

    router.post('/api/restablecer-password', limites.recuperacion, async (req, res) => {
        const { token, nuevaContrasena } = req.body;
        if (!token || !nuevaContrasena) {
            throw new ErrorHttp(400, "Datos incompletos para restablecer la contraseña.");
        }
        if (typeof token !== 'string' || typeof nuevaContrasena !== 'string' || nuevaContrasena.length < 6) {
            throw new ErrorHttp(400, "La contraseña debe tener al menos 6 caracteres.");
        }
        if (Buffer.byteLength(nuevaContrasena, 'utf8') > LARGO_MAXIMO_BCRYPT) {
            throw new ErrorHttp(400, "La contraseña es demasiado larga (máximo 72 caracteres).");
        }

        const [[usuario]] = await db.query(
            'SELECT UsuarioID FROM Usuarios WHERE TokenRecuperacion = ? AND ExpiracionToken > NOW()',
            [token]
        );
        if (!usuario) throw new ErrorHttp(400, "El token de recuperación es inválido o ha expirado.");

        await db.query(`
            UPDATE Usuarios
            SET ContrasenaHash = ?, TokenRecuperacion = NULL, ExpiracionToken = NULL,
                -- Abrir el enlace que llegó al correo demuestra que el correo es suyo
                CorreoVerificado = 1, TokenVerificacion = NULL, ExpiracionVerificacion = NULL
            WHERE UsuarioID = ?
        `, [await bcrypt.hash(nuevaContrasena, rondasBcrypt), usuario.UsuarioID]);
        res.json({ message: "¡Contraseña actualizada con éxito! Ahora puedes iniciar sesión." });
    });

    // ------------------------------------------------ CONFIRMACIÓN DEL CORREO
    router.get('/api/verificar-correo', async (req, res) => {
        const invalido = { ok: false, message: "El enlace no es válido o ya venció. Inicia sesión y pide uno nuevo." };
        if (!esTokenValido(req.query.token)) return res.status(400).json(invalido);
        const [resultado] = await db.query(
            `UPDATE Usuarios SET CorreoVerificado = 1, TokenVerificacion = NULL, ExpiracionVerificacion = NULL
             WHERE TokenVerificacion = ? AND ExpiracionVerificacion > NOW()`,
            [req.query.token]
        );
        if (resultado.affectedRows === 0) return res.status(400).json(invalido);
        res.json({ ok: true, message: "¡Listo! Tu correo quedó confirmado. Ya puedes iniciar sesión." });
    });

    // Reenviar el enlace de confirmación. Responde siempre lo mismo para no revelar qué correos existen.
    router.post('/api/reenviar-verificacion', limites.recuperacion, async (req, res) => {
        const emailLimpio = textoLimpio(req.body.email);
        if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
            throw new ErrorHttp(400, "Ingresa un correo electrónico válido.");
        }
        if (!puedeEnviar('verificar:' + emailLimpio.toLowerCase())) return res.json({ message: MENSAJE_REENVIO });

        const [[usuario]] = await db.query(
            'SELECT UsuarioID, CorreoElectronico FROM Usuarios WHERE CorreoElectronico = ? AND CorreoVerificado = 0',
            [emailLimpio]
        );
        if (!usuario) return res.json({ message: MENSAJE_REENVIO });

        const token = nuevoToken();
        await db.query(
            'UPDATE Usuarios SET TokenVerificacion = ?, ExpiracionVerificacion = ? WHERE UsuarioID = ?',
            [token, new Date(Date.now() + VIGENCIA_VERIFICACION_MS), usuario.UsuarioID]
        );
        enviarEnlaceVerificacion(usuario.CorreoElectronico, token, urlPublica(req));
        res.json({ message: MENSAJE_REENVIO });
    });

    return router;
}

module.exports = crearRutasCuentas;
