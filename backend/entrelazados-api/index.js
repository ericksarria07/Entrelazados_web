const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURACIÓN MÁGICA: Hace que Node.js pueda abrir tus archivos HTML
app.use(express.static(path.join(__dirname)));

// Configuración de la base de datos
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Erick_SarriaV2007',
    database: 'EntreLazadosDB'
});

db.connect((err) => {
    if (err) {
        console.error('Error conectando a la base de datos:', err);
        return;
    }
    console.log('¡Conectado exitosamente a la base de datos MySQL!');
});

// RUTA PARA REGISTRAR USUARIOS
app.post('/registro', (req, res) => {
    const { nombre, email, telefono, rol, deptoId } = req.body;
    const nombreDepartamento = deptoId ? deptoId.trim() : '';

    if (!nombreDepartamento) {
        return res.status(400).json({ message: "El departamento es obligatorio." });
    }

    console.log(`📩 Intento de registro para: ${nombre} - Depto: ${nombreDepartamento}`);

    const sqlBuscarDepto = `SELECT DepartamentoID FROM Departamentos WHERE NombreDepartamento = ?`;

    db.query(sqlBuscarDepto, [nombreDepartamento], (err, deptoResult) => {
        if (err) {
            console.error("❌ Error al buscar departamento:", err.message);
            return res.status(500).json({ message: "Error interno del servidor" });
        }

        const registrarUsuario = (idDelDepartamento) => {
            const sqlUsuario = `INSERT INTO Usuarios (NombreRazonSocial, TipoRol, CorreoElectronico, TelefonoWhatsApp, DepartamentoID) 
                                VALUES (?, ?, ?, ?, ?)`;

            db.query(sqlUsuario, [nombre, rol, email, telefono, idDelDepartamento], (err, result) => {
                if (err) {
                    console.error("❌ Error al insertar usuario en MySQL:", err.message);
                    return res.status(500).json({ message: err.message });
                }
                console.log("✅ ¡Usuario guardado en MySQL con éxito!");
                res.json({ message: "¡Registro exitoso en la plataforma!" });
            });
        };

        if (deptoResult.length > 0) {
            const idExistente = deptoResult[0].DepartamentoID;
            console.log(`📌 El departamento '${nombreDepartamento}' ya existe con ID: ${idExistente}. Asignando...`);
            registrarUsuario(idExistente);
        } else {
            console.log(`✨ '${nombreDepartamento}' es un departamento nuevo. Creándolo en la BD...`);
            const sqlInsertarDepto = `INSERT INTO Departamentos (NombreDepartamento) VALUES (?)`;

            db.query(sqlInsertarDepto, [nombreDepartamento], (err, insertResult) => {
                if (err) {
                    console.error("❌ Error al crear nuevo departamento:", err.message);
                    return res.status(500).json({ message: "Error al registrar el departamento" });
                }
                const nuevoId = insertResult.insertId;
                console.log(`🎉 Departamento creado exitosamente con ID automático: ${nuevoId}`);
                registrarUsuario(nuevoId);
            });
        }
    });
});

// RUTA PARA CONSULTAR OFERTAS (GET)
app.get('/api/ofertas', (req, res) => {
    const query = `
        SELECT o.OfertaID, o.ProveedorID, o.TituloMaterial, o.Precio, o.UnidadMedida, o.DistanciaSimuladaKm, c.NombreCategoria 
        FROM Ofertas o
        JOIN CategoriasMateriales c ON o.CategoriaID = c.CategoriaID
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// MODIFICADO: RUTA PARA PUBLICAR NUEVA OFERTA Y CREAR SUBASTA SIMULTÁNEAMENTE
app.post('/api/ofertas', (req, res) => {
    const { proveedorId, titulo, precio, unidad, distancia, categoriaId } = req.body;

    if (!proveedorId || !titulo || !precio || !unidad || !categoriaId) {
        return res.status(400).json({ message: "Por favor, llena todos los campos obligatorios." });
    }

    // Iniciamos la transacción para asegurar consistencia en ambas tablas
    db.beginTransaction((errTx) => {
        if (errTx) {
            console.error("❌ Error al iniciar transacción:", errTx.message);
            return res.status(500).json({ message: "Error al procesar el servidor." });
        }

        const queryInsertarOferta = `
            INSERT INTO Ofertas (ProveedorID, TituloMaterial, CategoriaID, Precio, UnidadMedida, DistanciaSimuladaKm) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(queryInsertarOferta, [proveedorId, titulo, categoriaId, precio, unidad, distancia || 0], (errOferta, resultOferta) => {
            if (errOferta) {
                return db.rollback(() => {
                    console.error("❌ Error al publicar oferta:", errOferta.message);
                    res.status(500).json({ message: "Error al guardar el material en la base de datos." });
                });
            }

            const nuevoOfertaId = resultOferta.insertId;
            // Se asume por defecto un vencimiento estándar (ej. 7 días hacia adelante)
            const fechaFinSimulada = new Date();
            fechaFinSimulada.setDate(fechaFinSimulada.getDate() + 7);

            const queryInsertarSubasta = `
                INSERT INTO Subastas (ProveedorID, OfertaID, TituloLote, PrecioBase, PrecioActual, FechaFin, Estado)
                VALUES (?, ?, ?, ?, ?, ?, 'Activa')
            `;

            const tituloLote = `Lote Subasta: ${titulo}`;

            db.query(queryInsertarSubasta, [proveedorId, nuevoOfertaId, tituloLote, precio, precio, fechaFinSimulada], (errSubasta) => {
                if (errSubasta) {
                    return db.rollback(() => {
                        console.error("❌ Error al crear subasta vinculada:", errSubasta.message);
                        res.status(500).json({ message: "Se canceló la operación por error en tabla Subastas." });
                    });
                }

                db.commit((errCommit) => {
                    if (errCommit) {
                        return db.rollback(() => {
                            res.status(500).json({ message: "Error al asentar los cambios en la BD." });
                        });
                    }
                    console.log("📦 ¡Oferta y Subasta sincronizada creadas con éxito!");
                    res.json({ message: "¡Material publicado y lote en subasta activo exitosamente!" });
                });
            });
        });
    });
});

// MODIFICADO: ELIMINAR OFERTA, SUBASTA Y PUJAS ASOCIADAS
app.delete('/api/ofertas/:id', (req, res) => {
    const ofertaId = req.params.id;
    const { proveedorId } = req.body;

    if (!proveedorId) {
        return res.status(400).json({ message: "Identificador de proveedor requerido." });
    }

    db.beginTransaction((errTx) => {
        if (errTx) {
            return res.status(500).json({ message: "Error de transacción en el servidor." });
        }

        // 1. Eliminar las pujas de la subasta vinculada a esta oferta
        const queryBorrarPujas = `
            DELETE FROM Pujas 
            WHERE SubastaID = (SELECT SubastaID FROM Subastas WHERE OfertaID = ? AND ProveedorID = ? LIMIT 1)
        `;

        db.query(queryBorrarPujas, [ofertaId, proveedorId], (errPujas) => {
            if (errPujas) {
                return db.rollback(() => {
                    console.error("❌ Error al limpiar pujas:", errPujas.message);
                    res.status(500).json({ message: "No se pudo actualizar las relaciones." });
                });
            }

            // 2. Eliminar la subasta vinculada
            const queryBorrarSubasta = `DELETE FROM Subastas WHERE OfertaID = ? AND ProveedorID = ?`;

            db.query(queryBorrarSubasta, [ofertaId, proveedorId], (errSubasta) => {
                if (errSubasta) {
                    return db.rollback(() => {
                        console.error("❌ Error al eliminar subasta vinculada:", errSubasta.message);
                        res.status(500).json({ message: "Error al purgar subasta activa." });
                    });
                }

                // 3. Eliminar la oferta original
                const queryBorrarOferta = `DELETE FROM Ofertas WHERE OfertaID = ? AND ProveedorID = ?`;

                db.query(queryBorrarOferta, [ofertaId, proveedorId], (errOferta, resultOferta) => {
                    if (errOferta) {
                        return db.rollback(() => {
                            console.error("❌ Error al eliminar oferta:", errOferta.message);
                            res.status(500).json({ message: "Error final al remover la oferta." });
                        });
                    }

                    if (resultOferta.affectedRows === 0) {
                        return db.rollback(() => {
                            res.status(403).json({ message: "No tienes permiso para eliminar esta oferta o no existe." });
                        });
                    }

                    db.commit((errCommit) => {
                        if (errCommit) {
                            return db.rollback(() => {
                                res.status(500).json({ message: "Fallo al confirmar el borrado." });
                            });
                        }
                        res.json({ success: true, message: "Oferta y subasta asociada eliminadas correctamente." });
                    });
                });
            });
        });
    });
});

// RUTA PARA OBTENER ESTADÍSTICAS REALES EN PANTALLA DE INICIO
app.get('/api/estadisticas', (req, res) => {
    const queryProveedores = "SELECT COUNT(*) AS total FROM Usuarios WHERE LOWER(TipoRol) = 'proveedor'";
    const queryEmprendedores = "SELECT COUNT(*) AS total FROM Usuarios WHERE LOWER(TipoRol) = 'emprendedor'";

    db.query(queryProveedores, (err, resultProv) => {
        if (err) {
            console.error("❌ Error al contar proveedores:", err.message);
            return res.status(500).json({ message: "Error en servidor" });
        }

        db.query(queryEmprendedores, (err, resultEmp) => {
            if (err) {
                console.error("❌ Error al contar emprendedores:", err.message);
                return res.status(500).json({ message: "Error en servidor" });
            }

            res.json({
                proveedores: resultProv[0].total,
                emprendedores: resultEmp[0].total,
                subastas: 28
            });
        });
    });
});

// RUTA DE LOGIN
app.post('/api/login', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: "El correo es obligatorio." });
    }

    const sqlBuscarUsuario = `SELECT UsuarioID, NombreRazonSocial, TipoRol FROM Usuarios WHERE CorreoElectronico = ?`;

    db.query(sqlBuscarUsuario, [email], (err, results) => {
        if (err) {
            console.error("❌ Error en Login:", err.message);
            return res.status(500).json({ message: "Error interno del servidor" });
        }

        if (results.length > 0) {
            res.json({
                id: results[0].UsuarioID,
                nombre: results[0].NombreRazonSocial,
                rol: results[0].TipoRol
            });
        } else {
            res.status(404).json({ message: "Este correo electrónico no está registrado." });
        }
    });
});

// SE TRAE EL ProveedorID PARA CONTROLAR BLOQUEOS DE PUJA EN EL FRONTEND
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

// RUTA PARA REGISTRAR UNA NUEVA PUJA
app.post('/api/pujas', (req, res) => {
    const { subastaId, emprendedorId, montoPuja } = req.body;

    if (!subastaId || !emprendedorId || !montoPuja) {
        return res.status(400).json({ message: "Datos de puja incompletos." });
    }

    const sqlInsertarPuja = `INSERT INTO Pujas (SubastaID, EmprendedorID, MontoPuja) VALUES (?, ?, ?)`;

    db.query(sqlInsertarPuja, [subastaId, emprendedorId, montoPuja], (err, result) => {
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

// CHAT 1: CONTACTOS DISPONIBLES SEGÚN EL ROL
app.get('/api/chat/contactos', (req, res) => {
    const { rol } = req.query;
    const rolBuscado = rol === 'emprendedor' ? 'proveedor' : 'emprendedor';

    const query = `SELECT UsuarioID, NombreRazonSocial, TipoRol FROM Usuarios WHERE LOWER(TipoRol) = ?`;

    db.query(query, [rolBuscado], (err, results) => {
        if (err) {
            console.error("❌ Error al obtener contactos:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// CHAT 2: OBTENER LOS MENSAJES ENTRE DOS USUARIOS
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

// CHAT 3: GUARDAR UN NUEVO MENSAJE
app.post('/api/chat/enviar', (req, res) => {
    const { remitenteId, destinatarioId, texto } = req.body;

    if (!remitenteId || !destinatarioId || !texto) {
        return res.status(400).json({ message: "Contenido del mensaje incompleto." });
    }

    const query = `
        INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto) 
        VALUES (?, ?, ?)
    `;

    db.query(query, [remitenteId, destinatarioId, texto], (err, result) => {
        if (err) {
            console.error("❌ Error al guardar mensaje en MySQL:", err.message);
            return res.status(500).json({ message: "Error interno al guardar mensaje." });
        }
        res.json({ success: true, message: "Mensaje enviado y guardado." });
    });
});

// Iniciar el servidor
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Backend corriendo en http://localhost:${PORT}`);
});