const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(express.static(path.join(__dirname)));

// Expresión regular para validación estricta de correo electrónico
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// CONFIGURACIÓN DE BASE DE DATOS EN SMARTERASP.NET
const db = mysql.createConnection({
    host: 'mysql8001.site4now.net',
    user: 'acd8d6_entrelazados',
    password: 'Entre_Lazados2026',
    database: 'db_acd8d6_entrelazados'
});

db.connect((err) => {
    if (err) {
        console.error('❌ Error conectando a la base de datos MySQL:', err.message);
        return;
    }
    console.log('✅ ¡Conectado exitosamente a la base de datos MySQL en SmarterASP!');
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'tu_correo@gmail.com',
        pass: 'tu_contrasena_de_aplicacion'
    }
});

// RUTA PARA REGISTRAR USUARIOS (CON VALIDACIÓN DE CORREO)
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
        capacidadProduccionMensual
    } = req.body;

    const nombreDepartamento = deptoId ? deptoId.trim() : '';
    const passwordHash = password || contrasena || '123456';
    const emailLimpio = email ? email.trim() : '';

    if (!nombreDepartamento || !emailLimpio || !nombre || !rol) {
        return res.status(400).json({ message: "Por favor, completa todos los campos obligatorios." });
    }

    if (!REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({
            message: "El correo electrónico no es válido. Debe incluir el dominio completo (ejemplo: usuario@gmail.com)."
        });
    }

    console.log(`📩 Intento de registro: ${nombre} (${rol}) - Depto: ${nombreDepartamento}`);

    const sqlBuscarDepto = `SELECT DepartamentoID FROM Departamentos WHERE NombreDepartamento = ?`;

    db.query(sqlBuscarDepto, [nombreDepartamento], (err, deptoResult) => {
        if (err) {
            console.error("❌ Error al buscar departamento:", err.message);
            return res.status(500).json({ message: "Error interno del servidor al verificar departamento." });
        }

        const procesarRegistro = (idDepartamento) => {
            db.beginTransaction((errTx) => {
                if (errTx) {
                    return res.status(500).json({ message: "Error al iniciar la transacción." });
                }

                const sqlUsuario = `
                    INSERT INTO Usuarios (CorreoElectronico, ContrasenaHash, TipoRol, EstadoCuenta) 
                    VALUES (?, ?, ?, 'Activo')
                `;

                db.query(sqlUsuario, [emailLimpio, passwordHash, rol], (errUser, resultUser) => {
                    if (errUser) {
                        return db.rollback(() => {
                            console.error("❌ Error al insertar usuario:", errUser.message);
                            res.status(500).json({ message: "El correo ya está registrado o hubo un error." });
                        });
                    }

                    const nuevoUsuarioId = resultUser.insertId;

                    const sqlPerfil = `
                        INSERT INTO PerfilesUsuarios (UsuarioID, NombreRazonSocial, TelefonoWhatsApp, DepartamentoID) 
                        VALUES (?, ?, ?, ?)
                    `;

                    db.query(sqlPerfil, [nuevoUsuarioId, nombre, telefono || '', idDepartamento], (errPerfil) => {
                        if (errPerfil) {
                            return db.rollback(() => {
                                console.error("❌ Error al crear perfil:", errPerfil.message);
                                res.status(500).json({ message: "Error al guardar el perfil del usuario." });
                            });
                        }

                        let sqlRol = '';
                        let paramsRol = [];

                        if (rol.toLowerCase() === 'proveedor') {
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

                        db.query(sqlRol, paramsRol, (errRol) => {
                            if (errRol) {
                                return db.rollback(() => {
                                    console.error("❌ Error al asignar rol específico:", errRol.message);
                                    res.status(500).json({ message: "Error al configurar datos del rol." });
                                });
                            }

                            db.commit((errCommit) => {
                                if (errCommit) {
                                    return db.rollback(() => {
                                        res.status(500).json({ message: "Error al confirmar el registro." });
                                    });
                                }
                                console.log(`✅ ¡Usuario '${nombre}' (${rol}) guardado en MySQL con ID: ${nuevoUsuarioId}!`);
                                res.json({ message: "¡Registro exitoso en la plataforma!" });
                            });
                        });
                    });
                });
            });
        };

        if (deptoResult.length > 0) {
            procesarRegistro(deptoResult[0].DepartamentoID);
        } else {
            const sqlInsertarDepto = `INSERT INTO Departamentos (NombreDepartamento) VALUES (?)`;
            db.query(sqlInsertarDepto, [nombreDepartamento], (errIns, insertResult) => {
                if (errIns) {
                    console.error("❌ Error al crear departamento:", errIns.message);
                    return res.status(500).json({ message: "Error al registrar el departamento." });
                }
                procesarRegistro(insertResult.insertId);
            });
        }
    });
});

// RUTA DE LOGIN (ACTUALIZADA PARA RETORNAR DEPARTAMENTO/UBICACIÓN)
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(express.static(path.join(__dirname)));

// Expresión regular para validación estricta de correo electrónico
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// CONFIGURACIÓN DE BASE DE DATOS EN SMARTERASP.NET
const db = mysql.createConnection({
    host: 'mysql8001.site4now.net',
    user: 'acd8d6_entrelazados',
    password: 'Entre_Lazados2026',
    database: 'db_acd8d6_entrelazados'
});

db.connect((err) => {
    if (err) {
        console.error('❌ Error conectando a la base de datos MySQL:', err.message);
        return;
    }
    console.log('✅ ¡Conectado exitosamente a la base de datos MySQL en SmarterASP!');
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'tu_correo@gmail.com',
        pass: 'tu_contrasena_de_aplicacion'
    }
});

// RUTA PARA REGISTRAR USUARIOS (CON VALIDACIÓN DE CORREO)
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
        capacidadProduccionMensual
    } = req.body;

    const nombreDepartamento = deptoId ? deptoId.trim() : '';
    const passwordHash = password || contrasena || '123456';
    const emailLimpio = email ? email.trim() : '';

    if (!nombreDepartamento || !emailLimpio || !nombre || !rol) {
        return res.status(400).json({ message: "Por favor, completa todos los campos obligatorios." });
    }

    if (!REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({
            message: "El correo electrónico no es válido. Debe incluir el dominio completo (ejemplo: usuario@gmail.com)."
        });
    }

    console.log(`📩 Intento de registro: ${nombre} (${rol}) - Depto: ${nombreDepartamento}`);

    const sqlBuscarDepto = `SELECT DepartamentoID FROM Departamentos WHERE NombreDepartamento = ?`;

    db.query(sqlBuscarDepto, [nombreDepartamento], (err, deptoResult) => {
        if (err) {
            console.error("❌ Error al buscar departamento:", err.message);
            return res.status(500).json({ message: "Error interno del servidor al verificar departamento." });
        }

        const procesarRegistro = (idDepartamento) => {
            db.beginTransaction((errTx) => {
                if (errTx) {
                    return res.status(500).json({ message: "Error al iniciar la transacción." });
                }

                const sqlUsuario = `
                    INSERT INTO Usuarios (CorreoElectronico, ContrasenaHash, TipoRol, EstadoCuenta) 
                    VALUES (?, ?, ?, 'Activo')
                `;

                db.query(sqlUsuario, [emailLimpio, passwordHash, rol], (errUser, resultUser) => {
                    if (errUser) {
                        return db.rollback(() => {
                            console.error("❌ Error al insertar usuario:", errUser.message);
                            res.status(500).json({ message: "El correo ya está registrado o hubo un error." });
                        });
                    }

                    const nuevoUsuarioId = resultUser.insertId;

                    const sqlPerfil = `
                        INSERT INTO PerfilesUsuarios (UsuarioID, NombreRazonSocial, TelefonoWhatsApp, DepartamentoID) 
                        VALUES (?, ?, ?, ?)
                    `;

                    db.query(sqlPerfil, [nuevoUsuarioId, nombre, telefono || '', idDepartamento], (errPerfil) => {
                        if (errPerfil) {
                            return db.rollback(() => {
                                console.error("❌ Error al crear perfil:", errPerfil.message);
                                res.status(500).json({ message: "Error al guardar el perfil del usuario." });
                            });
                        }

                        let sqlRol = '';
                        let paramsRol = [];

                        if (rol.toLowerCase() === 'proveedor') {
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

                        db.query(sqlRol, paramsRol, (errRol) => {
                            if (errRol) {
                                return db.rollback(() => {
                                    console.error("❌ Error al asignar rol específico:", errRol.message);
                                    res.status(500).json({ message: "Error al configurar datos del rol." });
                                });
                            }

                            db.commit((errCommit) => {
                                if (errCommit) {
                                    return db.rollback(() => {
                                        res.status(500).json({ message: "Error al confirmar el registro." });
                                    });
                                }
                                console.log(`✅ ¡Usuario '${nombre}' (${rol}) guardado en MySQL con ID: ${nuevoUsuarioId}!`);
                                res.json({ message: "¡Registro exitoso en la plataforma!" });
                            });
                        });
                    });
                });
            });
        };

        if (deptoResult.length > 0) {
            procesarRegistro(deptoResult[0].DepartamentoID);
        } else {
            const sqlInsertarDepto = `INSERT INTO Departamentos (NombreDepartamento) VALUES (?)`;
            db.query(sqlInsertarDepto, [nombreDepartamento], (errIns, insertResult) => {
                if (errIns) {
                    console.error("❌ Error al crear departamento:", errIns.message);
                    return res.status(500).json({ message: "Error al registrar el departamento." });
                }
                procesarRegistro(insertResult.insertId);
            });
        }
    });
});

// RUTA DE LOGIN (ACTUALIZADA PARA RETORNAR DEPARTAMENTO/UBICACIÓN)
app.post('/api/login', (req, res) => {
    const { email } = req.body;
    const emailLimpio = email ? email.trim() : '';

    if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({ message: "Ingresa un correo electrónico válido (ejemplo: usuario@gmail.com)." });
    }

    const sqlBuscarUsuario = `
        SELECT u.UsuarioID, p.NombreRazonSocial, u.TipoRol, d.NombreDepartamento
        FROM Usuarios u
        JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
        LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
        WHERE u.CorreoElectronico = ?
    `;

    db.query(sqlBuscarUsuario, [emailLimpio], (err, results) => {
        if (err) {
            console.error("❌ Error en Login:", err.message);
            return res.status(500).json({ message: "Error interno del servidor" });
        }

        if (results.length > 0) {
            res.json({
                id: results[0].UsuarioID,
                nombre: results[0].NombreRazonSocial,
                rol: results[0].TipoRol,
                departamento: results[0].NombreDepartamento || 'Managua'
            });
        } else {
            res.status(404).json({ message: "Este correo electrónico no está registrado." });
        }
    });
});

// RUTAS PARA RECUPERACIÓN DE CONTRASEÑA
app.post('/api/solicitar-recuperacion', (req, res) => {
    const { email } = req.body;
    const emailLimpio = email ? email.trim() : '';

    if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({ message: "Por favor proporciona un correo electrónico válido." });
    }

    const sqlBuscar = `SELECT UsuarioID FROM Usuarios WHERE CorreoElectronico = ?`;

    db.query(sqlBuscar, [emailLimpio], (err, results) => {
        if (err || results.length === 0) {
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
                console.error("❌ Error al guardar token de recuperación:", errToken.message);
                return res.status(500).json({ message: "Error interno al generar enlace." });
            }

            const hostActual = req.get('host');
            const enlace = `${req.protocol}://${hostActual}/restablecer.html?token=${token}`;

            const mailOptions = {
                from: '"EntreLazados" <tu_correo@gmail.com>',
                to: emailLimpio,
                subject: 'Recuperación de Contraseña - EntreLazados',
                html: `
                    <h3>Recuperación de Contraseña</h3>
                    <p>Solicitaste restablecer tu contraseña en EntreLazados. Haz clic en el enlace a continuación:</p>
                    <a href="${enlace}" target="_blank">${enlace}</a>
                    <p>Este enlace estará activo durante 1 hora.</p>
                `
            };

            transporter.sendMail(mailOptions, (errorInfo) => {
                if (errorInfo) {
                    console.error("❌ Error enviando correo de recuperación:", errorInfo.message);
                } else {
                    console.log(`📧 Correo de recuperación enviado a: ${emailLimpio}`);
                }
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

    const sqlVerificarToken = `
        SELECT UsuarioID FROM Usuarios 
        WHERE TokenRecuperacion = ? AND ExpiracionToken > NOW()
    `;

    db.query(sqlVerificarToken, [token], (err, results) => {
        if (err || results.length === 0) {
            return res.status(400).json({ message: "El token de recuperación es inválido o ha expirado." });
        }

        const usuarioId = results[0].UsuarioID;
        const sqlActualizarPass = `
            UPDATE Usuarios 
            SET ContrasenaHash = ?, TokenRecuperacion = NULL, ExpiracionToken = NULL 
            WHERE UsuarioID = ?
        `;

        db.query(sqlActualizarPass, [nuevaContrasena, usuarioId], (errUpdate) => {
            if (errUpdate) {
                console.error("❌ Error al cambiar contraseña:", errUpdate.message);
                return res.status(500).json({ message: "Error al cambiar la contraseña." });
            }

            console.log(`🔑 ¡Contraseña actualizada exitosamente para el Usuario ID: ${usuarioId}!`);
            res.json({ message: "¡Contraseña actualizada con éxito! Ahora puedes iniciar sesión." });
        });
    });
});

// ==========================================
// RUTAS PARA OFERTAS
// ==========================================

app.get('/api/ofertas', (req, res) => {
    const query = `
        SELECT o.OfertaID, o.ProveedorID, o.TituloMaterial, o.Precio, o.UnidadMedida, o.DistanciaSimuladaKm, o.Fotos, c.NombreCategoria 
        FROM Ofertas o
        JOIN CategoriasMateriales c ON o.CategoriaID = c.CategoriaID
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        const ofertasFormateadas = results.map(oferta => ({
            ...oferta,
            Fotos: oferta.Fotos ? JSON.parse(oferta.Fotos) : []
        }));

        res.json(ofertasFormateadas);
    });
});

app.post('/api/ofertas', (req, res) => {
    const { proveedorId, titulo, precio, unidad, distancia, categoriaId, fotos } = req.body;

    if (!proveedorId || !titulo || !precio || !unidad || !categoriaId) {
        return res.status(400).json({ message: "Por favor, llena todos los campos obligatorios." });
    }

    db.beginTransaction((errTx) => {
        if (errTx) {
            return res.status(500).json({ message: "Error al procesar el servidor." });
        }

        const fotosJSON = JSON.stringify(fotos || []);

        const queryInsertarOferta = `
            INSERT INTO Ofertas (ProveedorID, TituloMaterial, CategoriaID, Precio, UnidadMedida, DistanciaSimuladaKm, Fotos) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(queryInsertarOferta, [proveedorId, titulo, categoriaId, precio, unidad, distancia || 0, fotosJSON], (errOferta) => {
            if (errOferta) {
                return db.rollback(() => {
                    console.error("❌ Error al publicar oferta:", errOferta.message);
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

            db.query(queryInsertarSubasta, [proveedorId, tituloLote, precio, precio, fechaFinSimulada], (errSubasta) => {
                if (errSubasta) {
                    return db.rollback(() => {
                        console.error("❌ Error al crear subasta vinculada:", errSubasta.message);
                        res.status(500).json({ message: "Error al crear la subasta en la base de datos." });
                    });
                }

                db.commit((errCommit) => {
                    if (errCommit) {
                        return db.rollback(() => {
                            res.status(500).json({ message: "Error al asentar los cambios." });
                        });
                    }
                    console.log("📦 ¡Oferta y Subasta creada con éxito!");
                    res.json({ message: "¡Material publicado y lote en subasta activo exitosamente!" });
                });
            });
        });
    });
});

app.delete('/api/ofertas/:id', (req, res) => {
    const ofertaId = req.params.id;
    const { proveedorId } = req.body;

    if (!proveedorId) {
        return res.status(400).json({ message: "Identificador de proveedor requerido." });
    }

    const queryBorrarOferta = `DELETE FROM Ofertas WHERE OfertaID = ? AND ProveedorID = ?`;

    db.query(queryBorrarOferta, [ofertaId, proveedorId], (errOferta, resultOferta) => {
        if (errOferta) {
            console.error("❌ Error al eliminar oferta:", errOferta.message);
            return res.status(500).json({ message: "Error al remover la oferta." });
        }

        if (resultOferta.affectedRows === 0) {
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
            console.error("❌ Error al obtener subastas:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

app.post('/api/pujas', (req, res) => {
    const { subastaId, emprendedorId, montoPuja } = req.body;

    if (!subastaId || !emprendedorId || !montoPuja) {
        return res.status(400).json({ message: "Datos de puja incompletos." });
    }

    const sqlInsertarPuja = `INSERT INTO Pujas (SubastaID, EmprendedorID, MontoPuja) VALUES (?, ?, ?)`;

    db.query(sqlInsertarPuja, [subastaId, emprendedorId, montoPuja], (err) => {
        if (err) {
            console.error("❌ Error al insertar puja:", err.message);
            return res.status(500).json({ message: "No se pudo registrar la puja." });
        }

        const sqlActualizarSubasta = `UPDATE Subastas SET PrecioActual = ? WHERE SubastaID = ?`;
        db.query(sqlActualizarSubasta, [montoPuja, subastaId], (errUpdate) => {
            if (errUpdate) {
                console.error("❌ Error al actualizar precio actual:", errUpdate.message);
                return res.status(500).json({ message: "Puja registrada, pero no se actualizó el lote." });
            }

            console.log(`🔨 ¡Nueva puja de C$${montoPuja} registrada con éxito!`);
            res.json({ message: "¡Tu puja ha sido aceptada exitosamente!" });
        });
    });
});

// RUTAS DE CHAT EN VIVO
app.get('/api/chat/contactos', (req, res) => {
    const { rol } = req.query;
    const rolBuscado = (rol && rol.toLowerCase() === 'emprendedor') ? 'Proveedor' : 'Emprendedor';

    const query = `
        SELECT u.UsuarioID, p.NombreRazonSocial, u.TipoRol 
        FROM Usuarios u
        JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
        WHERE u.TipoRol = ?
    `;

    db.query(query, [rolBuscado], (err, results) => {
        if (err) {
            console.error("❌ Error al obtener contactos:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

app.get('/api/chat/mensajes', (req, res) => {
    const { remitenteId, destinatarioId } = req.query;

    if (!remitenteId || !destinatarioId) {
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
        if (err) {
            console.error("❌ Error al recuperar mensajes:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

app.post('/api/chat/enviar', (req, res) => {
    const { remitenteId, destinatarioId, texto } = req.body;

    if (!remitenteId || !destinatarioId || !texto) {
        return res.status(400).json({ message: "Contenido del mensaje incompleto." });
    }

    const query = `
        INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto) 
        VALUES (?, ?, ?)
    `;

    db.query(query, [remitenteId, destinatarioId, texto], (err) => {
        if (err) {
            console.error("❌ Error al guardar mensaje en MySQL:", err.message);
            return res.status(500).json({ message: "Error interno al guardar mensaje." });
        }
        res.json({ success: true, message: "Mensaje enviado y guardado." });
    });
});

// ESTADÍSTICAS DEL INICIO
app.get('/api/estadisticas', (req, res) => {
    const queryProveedores = "SELECT COUNT(*) AS total FROM Usuarios WHERE LOWER(TipoRol) = 'proveedor'";
    const queryEmprendedores = "SELECT COUNT(*) AS total FROM Usuarios WHERE LOWER(TipoRol) = 'emprendedor'";
    const querySubastas = "SELECT COUNT(*) AS total FROM Subastas WHERE Estado = 'Activa'";

    db.query(queryProveedores, (err, resultProv) => {
        if (err) return res.status(500).json({ message: "Error en servidor" });

        db.query(queryEmprendedores, (err, resultEmp) => {
            if (err) return res.status(500).json({ message: "Error en servidor" });

            db.query(querySubastas, (err, resultSub) => {
                if (err) return res.status(500).json({ message: "Error en servidor" });

                res.json({
                    proveedores: resultProv[0].total,
                    emprendedores: resultEmp[0].total,
                    subastas: resultSub[0].total
                });
            });
        });
    });
});

// RUTA PARA OBTENER EL PERFIL DEL USUARIO
app.get('/api/perfil/:id', (req, res) => {
    const usuarioId = req.params.id;

    const query = `
        SELECT 
            u.UsuarioID, 
            u.CorreoElectronico, 
            u.TipoRol, 
            p.NombreRazonSocial, 
            p.TelefonoWhatsApp, 
            d.NombreDepartamento,
            prov.NumeroRUC, 
            prov.NombreComercial, 
            prov.TipoMateriaPrimaPrincipal, 
            prov.DescripcionEmpresa,
            emp.NombreMarca, 
            emp.EspecialidadCalzado, 
            emp.CapacidadProduccionMensual
        FROM Usuarios u
        LEFT JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
        LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
        LEFT JOIN Proveedores prov ON u.UsuarioID = prov.UsuarioID
        LEFT JOIN Emprendedores emp ON u.UsuarioID = emp.UsuarioID
        WHERE u.UsuarioID = ?
    `;

    db.query(query, [usuarioId], (err, results) => {
        if (err) {
            console.error("❌ Error al obtener perfil:", err.message);
            return res.status(500).json({ message: "Error al consultar la base de datos." });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: "Usuario no encontrado." });
        }

        res.json(results[0]);
    });
});

// Arrancar el servidor backend con el puerto asignado por el hosting
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 Servidor Backend ejecutándose en el puerto ${PORT}`);
});

// RUTAS PARA RECUPERACIÓN DE CONTRASEÑA
app.post('/api/solicitar-recuperacion', (req, res) => {
    const { email } = req.body;
    const emailLimpio = email ? email.trim() : '';

    if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) {
        return res.status(400).json({ message: "Por favor proporciona un correo electrónico válido." });
    }

    const sqlBuscar = `SELECT UsuarioID FROM Usuarios WHERE CorreoElectronico = ?`;

    db.query(sqlBuscar, [emailLimpio], (err, results) => {
        if (err || results.length === 0) {
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
                console.error("❌ Error al guardar token de recuperación:", errToken.message);
                return res.status(500).json({ message: "Error interno al generar enlace." });
            }

            const hostActual = req.get('host');
            const enlace = `${req.protocol}://${hostActual}/restablecer.html?token=${token}`;

            const mailOptions = {
                from: '"EntreLazados" <tu_correo@gmail.com>',
                to: emailLimpio,
                subject: 'Recuperación de Contraseña - EntreLazados',
                html: `
                    <h3>Recuperación de Contraseña</h3>
                    <p>Solicitaste restablecer tu contraseña en EntreLazados. Haz clic en el enlace a continuación:</p>
                    <a href="${enlace}" target="_blank">${enlace}</a>
                    <p>Este enlace estará activo durante 1 hora.</p>
                `
            };

            transporter.sendMail(mailOptions, (errorInfo) => {
                if (errorInfo) {
                    console.error("❌ Error enviando correo de recuperación:", errorInfo.message);
                } else {
                    console.log(`📧 Correo de recuperación enviado a: ${emailLimpio}`);
                }
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

    const sqlVerificarToken = `
        SELECT UsuarioID FROM Usuarios 
        WHERE TokenRecuperacion = ? AND ExpiracionToken > NOW()
    `;

    db.query(sqlVerificarToken, [token], (err, results) => {
        if (err || results.length === 0) {
            return res.status(400).json({ message: "El token de recuperación es inválido o ha expirado." });
        }

        const usuarioId = results[0].UsuarioID;
        const sqlActualizarPass = `
            UPDATE Usuarios 
            SET ContrasenaHash = ?, TokenRecuperacion = NULL, ExpiracionToken = NULL 
            WHERE UsuarioID = ?
        `;

        db.query(sqlActualizarPass, [nuevaContrasena, usuarioId], (errUpdate) => {
            if (errUpdate) {
                console.error("❌ Error al cambiar contraseña:", errUpdate.message);
                return res.status(500).json({ message: "Error al cambiar la contraseña." });
            }

            console.log(`🔑 ¡Contraseña actualizada exitosamente para el Usuario ID: ${usuarioId}!`);
            res.json({ message: "¡Contraseña actualizada con éxito! Ahora puedes iniciar sesión." });
        });
    });
});

// ==========================================
// RUTAS PARA OFERTAS
// ==========================================

app.get('/api/ofertas', (req, res) => {
    const query = `
        SELECT o.OfertaID, o.ProveedorID, o.TituloMaterial, o.Precio, o.UnidadMedida, o.DistanciaSimuladaKm, o.Fotos, c.NombreCategoria 
        FROM Ofertas o
        JOIN CategoriasMateriales c ON o.CategoriaID = c.CategoriaID
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        const ofertasFormateadas = results.map(oferta => ({
            ...oferta,
            Fotos: oferta.Fotos ? JSON.parse(oferta.Fotos) : []
        }));

        res.json(ofertasFormateadas);
    });
});

app.post('/api/ofertas', (req, res) => {
    const { proveedorId, titulo, precio, unidad, distancia, categoriaId, fotos } = req.body;

    if (!proveedorId || !titulo || !precio || !unidad || !categoriaId) {
        return res.status(400).json({ message: "Por favor, llena todos los campos obligatorios." });
    }

    db.beginTransaction((errTx) => {
        if (errTx) {
            return res.status(500).json({ message: "Error al procesar el servidor." });
        }

        const fotosJSON = JSON.stringify(fotos || []);

        const queryInsertarOferta = `
            INSERT INTO Ofertas (ProveedorID, TituloMaterial, CategoriaID, Precio, UnidadMedida, DistanciaSimuladaKm, Fotos) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(queryInsertarOferta, [proveedorId, titulo, categoriaId, precio, unidad, distancia || 0, fotosJSON], (errOferta) => {
            if (errOferta) {
                return db.rollback(() => {
                    console.error("❌ Error al publicar oferta:", errOferta.message);
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

            db.query(queryInsertarSubasta, [proveedorId, tituloLote, precio, precio, fechaFinSimulada], (errSubasta) => {
                if (errSubasta) {
                    return db.rollback(() => {
                        console.error("❌ Error al crear subasta vinculada:", errSubasta.message);
                        res.status(500).json({ message: "Error al crear la subasta en la base de datos." });
                    });
                }

                db.commit((errCommit) => {
                    if (errCommit) {
                        return db.rollback(() => {
                            res.status(500).json({ message: "Error al asentar los cambios." });
                        });
                    }
                    console.log("📦 ¡Oferta y Subasta creada con éxito!");
                    res.json({ message: "¡Material publicado y lote en subasta activo exitosamente!" });
                });
            });
        });
    });
});

app.delete('/api/ofertas/:id', (req, res) => {
    const ofertaId = req.params.id;
    const { proveedorId } = req.body;

    if (!proveedorId) {
        return res.status(400).json({ message: "Identificador de proveedor requerido." });
    }

    const queryBorrarOferta = `DELETE FROM Ofertas WHERE OfertaID = ? AND ProveedorID = ?`;

    db.query(queryBorrarOferta, [ofertaId, proveedorId], (errOferta, resultOferta) => {
        if (errOferta) {
            console.error("❌ Error al eliminar oferta:", errOferta.message);
            return res.status(500).json({ message: "Error al remover la oferta." });
        }

        if (resultOferta.affectedRows === 0) {
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
            console.error("❌ Error al obtener subastas:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

app.post('/api/pujas', (req, res) => {
    const { subastaId, emprendedorId, montoPuja } = req.body;

    if (!subastaId || !emprendedorId || !montoPuja) {
        return res.status(400).json({ message: "Datos de puja incompletos." });
    }

    const sqlInsertarPuja = `INSERT INTO Pujas (SubastaID, EmprendedorID, MontoPuja) VALUES (?, ?, ?)`;

    db.query(sqlInsertarPuja, [subastaId, emprendedorId, montoPuja], (err) => {
        if (err) {
            console.error("❌ Error al insertar puja:", err.message);
            return res.status(500).json({ message: "No se pudo registrar la puja." });
        }

        const sqlActualizarSubasta = `UPDATE Subastas SET PrecioActual = ? WHERE SubastaID = ?`;
        db.query(sqlActualizarSubasta, [montoPuja, subastaId], (errUpdate) => {
            if (errUpdate) {
                console.error("❌ Error al actualizar precio actual:", errUpdate.message);
                return res.status(500).json({ message: "Puja registrada, pero no se actualizó el lote." });
            }

            console.log(`🔨 ¡Nueva puja de C$${montoPuja} registrada con éxito!`);
            res.json({ message: "¡Tu puja ha sido aceptada exitosamente!" });
        });
    });
});

// RUTAS DE CHAT EN VIVO
app.get('/api/chat/contactos', (req, res) => {
    const { rol } = req.query;
    const rolBuscado = (rol && rol.toLowerCase() === 'emprendedor') ? 'Proveedor' : 'Emprendedor';

    const query = `
        SELECT u.UsuarioID, p.NombreRazonSocial, u.TipoRol 
        FROM Usuarios u
        JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
        WHERE u.TipoRol = ?
    `;

    db.query(query, [rolBuscado], (err, results) => {
        if (err) {
            console.error("❌ Error al obtener contactos:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

app.get('/api/chat/mensajes', (req, res) => {
    const { remitenteId, destinatarioId } = req.query;

    if (!remitenteId || !destinatarioId) {
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
        if (err) {
            console.error("❌ Error al recuperar mensajes:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

app.post('/api/chat/enviar', (req, res) => {
    const { remitenteId, destinatarioId, texto } = req.body;

    if (!remitenteId || !destinatarioId || !texto) {
        return res.status(400).json({ message: "Contenido del mensaje incompleto." });
    }

    const query = `
        INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto) 
        VALUES (?, ?, ?)
    `;

    db.query(query, [remitenteId, destinatarioId, texto], (err) => {
        if (err) {
            console.error("❌ Error al guardar mensaje en MySQL:", err.message);
            return res.status(500).json({ message: "Error interno al guardar mensaje." });
        }
        res.json({ success: true, message: "Mensaje enviado y guardado." });
    });
});

// ESTADÍSTICAS DEL INICIO
app.get('/api/estadisticas', (req, res) => {
    const queryProveedores = "SELECT COUNT(*) AS total FROM Usuarios WHERE LOWER(TipoRol) = 'proveedor'";
    const queryEmprendedores = "SELECT COUNT(*) AS total FROM Usuarios WHERE LOWER(TipoRol) = 'emprendedor'";
    const querySubastas = "SELECT COUNT(*) AS total FROM Subastas WHERE Estado = 'Activa'";

    db.query(queryProveedores, (err, resultProv) => {
        if (err) return res.status(500).json({ message: "Error en servidor" });

        db.query(queryEmprendedores, (err, resultEmp) => {
            if (err) return res.status(500).json({ message: "Error en servidor" });

            db.query(querySubastas, (err, resultSub) => {
                if (err) return res.status(500).json({ message: "Error en servidor" });

                res.json({
                    proveedores: resultProv[0].total,
                    emprendedores: resultEmp[0].total,
                    subastas: resultSub[0].total
                });
            });
        });
    });
});

// RUTA PARA OBTENER EL PERFIL DEL USUARIO
app.get('/api/perfil/:id', (req, res) => {
    const usuarioId = req.params.id;

    const query = `
        SELECT 
            u.UsuarioID, 
            u.CorreoElectronico, 
            u.TipoRol, 
            p.NombreRazonSocial, 
            p.TelefonoWhatsApp, 
            d.NombreDepartamento,
            prov.NumeroRUC, 
            prov.NombreComercial, 
            prov.TipoMateriaPrimaPrincipal, 
            prov.DescripcionEmpresa,
            emp.NombreMarca, 
            emp.EspecialidadCalzado, 
            emp.CapacidadProduccionMensual
        FROM Usuarios u
        LEFT JOIN PerfilesUsuarios p ON u.UsuarioID = p.UsuarioID
        LEFT JOIN Departamentos d ON p.DepartamentoID = d.DepartamentoID
        LEFT JOIN Proveedores prov ON u.UsuarioID = prov.UsuarioID
        LEFT JOIN Emprendedores emp ON u.UsuarioID = emp.UsuarioID
        WHERE u.UsuarioID = ?
    `;

    db.query(query, [usuarioId], (err, results) => {
        if (err) {
            console.error("❌ Error al obtener perfil:", err.message);
            return res.status(500).json({ message: "Error al consultar la base de datos." });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: "Usuario no encontrado." });
        }

        res.json(results[0]);
    });
});

// Arrancar el servidor backend con el puerto asignado por el hosting
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 Servidor Backend ejecutándose en el puerto ${PORT}`);
});