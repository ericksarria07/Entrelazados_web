// ==========================================================================
// PANEL DE ADMINISTRADOR (todas piden sesión de administrador). Se monta en /api/admin
//   GET    /metricas                      contadores de la plataforma
//   GET    /usuarios                      ?buscar= &problemas=1 &pagina= &porPagina=
//   PUT    /usuarios/:id/correo           corregir un correo mal escrito
//   PUT    /usuarios/:id/verificar        dar por confirmado el correo
//   PUT    /usuarios/:id/estado           Activo | Inactivo | Suspendido
//   DELETE /usuarios/:id                  eliminar la cuenta con todo lo suyo
//   DELETE /ofertas/:id                   retirar una publicación (moderación)
//   POST   /subastas/cerrar-vencidas      cerrar ahora las subastas vencidas
//   POST   /categorias                    crear una categoría
// ==========================================================================
const express = require('express');
const fotos = require('../servicios/fotos');
const { avisarPujadoresCancelacion } = require('../servicios/subastas');
const { mensajeOfertaBorrada } = require('../servicios/ofertas');
const { enTransaccion } = require('../db');
const {
    ErrorHttp, REGEX_EMAIL, REGEXP_EMAIL_SQL, enteroPositivo, leerPaginacion, respuestaPaginada, patronLike, textoLimpio
} = require('../utilidades');

const ESTADOS_CUENTA = ['Activo', 'Inactivo', 'Suspendido'];
const MOTIVO_BAJA = 'porque la cuenta del proveedor fue dada de baja';

function crearRutasAdmin({ db, ofertas, cierreSubastas, tiempoReal, verificarAdmin }) {
    const router = express.Router();
    router.use(verificarAdmin);

    const usuarioNoEncontrado = () => new ErrorHttp(404, "Usuario no encontrado.");

    router.get('/metricas', async (req, res) => {
        const [[metricas]] = await db.query(`
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
        `, [REGEXP_EMAIL_SQL]);
        res.json(metricas || {});
    });

    // ?buscar=texto (nombre o correo), ?problemas=1 (correo inválido o sin confirmar),
    // ?pagina=N&porPagina=M para paginar (sin ?pagina devuelve la lista completa).
    router.get('/usuarios', async (req, res) => {
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

        const [filas] = await db.query(`
            SELECT
                u.UsuarioID, u.CorreoElectronico, u.TipoRol,
                COALESCE(u.EstadoCuenta, 'Activo') AS EstadoCuenta,
                u.FechaRegistro AS FechaCreacion, u.CorreoVerificado,
                p.NombreRazonSocial, p.TelefonoWhatsApp, d.NombreDepartamento
            ${desde}
            ORDER BY u.UsuarioID DESC
            ${pag ? 'LIMIT ? OFFSET ?' : ''}
        `, pag ? [...params, pag.porPagina, pag.offset] : params);
        // CorreoValido = false: el correo no tiene dominio completo (p. ej. "erick@gmail") y no puede iniciar sesión
        const lista = filas.map(u => ({ ...u, CorreoVerificado: !!u.CorreoVerificado, CorreoValido: REGEX_EMAIL.test(u.CorreoElectronico || '') }));
        if (!pag) return res.json(lista);
        const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${desde}`, params);
        res.json(respuestaPaginada(lista, Number(total), pag));
    });

    // CORREGIR EL CORREO DE UNA CUENTA (p. ej. "erick@gmail" sin ".com", que no puede entrar).
    // El administrador lo confirma con la persona, así que la cuenta queda verificada.
    router.put('/usuarios/:id/correo', async (req, res) => {
        const usuarioId = enteroPositivo(req.params.id);
        const correoNuevo = textoLimpio(req.body.correo);
        if (!REGEX_EMAIL.test(correoNuevo) || correoNuevo.length > 100) {
            throw new ErrorHttp(400, "Escribe un correo válido con su dominio completo (ejemplo: usuario@gmail.com).");
        }
        if (!usuarioId) throw usuarioNoEncontrado();
        const [resultado] = await db.query(
            `UPDATE Usuarios SET CorreoElectronico = ?, CorreoVerificado = 1, TokenVerificacion = NULL, ExpiracionVerificacion = NULL
             WHERE UsuarioID = ?`,
            [correoNuevo, usuarioId]
        ).catch((err) => {
            if (err.code === 'ER_DUP_ENTRY') throw new ErrorHttp(409, "Ese correo ya lo usa otra cuenta.");
            throw err;
        });
        if (resultado.affectedRows === 0) throw usuarioNoEncontrado();
        res.json({ success: true, message: `Correo actualizado a ${correoNuevo}. La persona ya puede iniciar sesión con él.` });
    });

    // DAR POR CONFIRMADO EL CORREO DE UNA CUENTA (si no le llega el enlace)
    router.put('/usuarios/:id/verificar', async (req, res) => {
        const usuarioId = enteroPositivo(req.params.id);
        if (!usuarioId) throw usuarioNoEncontrado();
        const [resultado] = await db.query(
            'UPDATE Usuarios SET CorreoVerificado = 1, TokenVerificacion = NULL, ExpiracionVerificacion = NULL WHERE UsuarioID = ?',
            [usuarioId]
        );
        if (resultado.affectedRows === 0) throw usuarioNoEncontrado();
        res.json({ success: true, message: "Correo marcado como confirmado. La cuenta ya puede iniciar sesión." });
    });

    // CAMBIAR EL ESTADO DE UNA CUENTA. Suspendida, pierde el acceso al instante (ver verificarToken).
    router.put('/usuarios/:id/estado', async (req, res) => {
        const { nuevoEstado } = req.body;
        if (!ESTADOS_CUENTA.includes(nuevoEstado)) {
            throw new ErrorHttp(400, "Estado no válido. Valores admitidos: Activo, Inactivo, Suspendido.");
        }
        const [resultado] = await db.query('UPDATE Usuarios SET EstadoCuenta = ? WHERE UsuarioID = ?', [nuevoEstado, req.params.id]);
        if (resultado.affectedRows === 0) throw usuarioNoEncontrado();
        // También se cortan sus conexiones en tiempo real (dejan de llegarle avisos)
        if (nuevoEstado === 'Suspendido') tiempoReal.desconectarUsuario(Number(req.params.id));
        res.json({ success: true, message: `Estado del usuario cambiado a '${nuevoEstado}'.` });
    });

    // ELIMINAR UNA CUENTA POR COMPLETO
    router.delete('/usuarios/:id', async (req, res) => {
        const usuarioId = Number(req.params.id);
        if (usuarioId === req.usuario.id) {
            throw new ErrorHttp(400, "No puedes eliminar tu propia cuenta de administrador.");
        }
        if (!enteroPositivo(usuarioId)) throw new ErrorHttp(404, "El usuario a eliminar no existe.");

        // Ofertas, Subastas, Pujas, MensajesChat y TratosCerrados apuntan al usuario SIN
        // "ON DELETE CASCADE", así que MySQL no deja borrarlo directamente.
        // Se eliminan primero sus registros, todo dentro de una transacción
        // (si algo falla no se borra nada).
        const pasos = [
            ['DELETE FROM Calificaciones WHERE AutorID = ? OR CalificadoID = ?', [usuarioId, usuarioId]],
            ['DELETE FROM MensajesChat WHERE RemitenteID = ? OR DestinatarioID = ?', [usuarioId, usuarioId]],
            ['DELETE FROM TratosCerrados WHERE ProveedorID = ? OR EmprendedorID = ?', [usuarioId, usuarioId]],
            ['DELETE FROM Pujas WHERE EmprendedorID = ?', [usuarioId]],
            ['DELETE FROM Subastas WHERE ProveedorID = ?', [usuarioId]],   // sus pujas se borran en cascada
            ['DELETE FROM Ofertas WHERE ProveedorID = ?', [usuarioId]],    // sus fotos se borran en cascada
            ['DELETE FROM Usuarios WHERE UsuarioID = ?', [usuarioId]]      // perfil, roles, etc. en cascada
        ];

        const { urlsFotos, avisos } = await enTransaccion(db, async (conn) => {
            const [[existe]] = await conn.query('SELECT UsuarioID FROM Usuarios WHERE UsuarioID = ? FOR UPDATE', [usuarioId]);
            if (!existe) throw new ErrorHttp(404, "El usuario a eliminar no existe.");

            // Las fotos de sus ofertas se anotan antes, para borrar los archivos al final
            const [filasFotos] = await conn.query(
                'SELECT f.FotoURL FROM FotosOfertas f JOIN Ofertas o ON o.OfertaID = f.OfertaID WHERE o.ProveedorID = ?',
                [usuarioId]
            );
            // Sus subastas abiertas desaparecen: se avisa por el chat a quienes habían pujado
            const [abiertas] = await conn.query(
                "SELECT SubastaID FROM Subastas WHERE ProveedorID = ? AND Estado = 'Activa' AND FechaFin > NOW()",
                [usuarioId]
            );
            const avisos = await avisarPujadoresCancelacion(conn, {
                subastaIds: abiertas.map(s => s.SubastaID),
                remitenteId: req.usuario.id,
                motivo: MOTIVO_BAJA
            });
            for (const [sql, params] of pasos) await conn.query(sql, params);
            return { urlsFotos: filasFotos.map(f => f.FotoURL), avisos };
        });

        await fotos.borrarFotos(urlsFotos);
        tiempoReal.desconectarUsuario(usuarioId);
        if (avisos.length > 0) tiempoReal.aTodos('subastas:cambio', { motivo: 'cancelada' });
        await cierreSubastas.avisarCancelacion(avisos, MOTIVO_BAJA);
        const pujadoresAvisados = new Set(avisos.map(a => a.emprendedorId)).size;
        res.json({
            success: true,
            message: "Usuario y sus registros asociados eliminados correctamente." +
                (pujadoresAvisados ? ` Avisamos por el chat a ${pujadoresAvisados} persona(s) que habían pujado en sus subastas.` : ''),
            pujadoresAvisados
        });
    });

    // MODERACIÓN: retirar cualquier publicación (se avisa a quienes pujaron en su subasta)
    router.delete('/ofertas/:id', async (req, res) => {
        const resultado = await ofertas.eliminarOferta(req.params.id, { moderadorId: req.usuario.id });
        if (!resultado.borrada) throw new ErrorHttp(404, "La oferta no existe o ya fue eliminada.");
        res.json({
            success: true,
            message: mensajeOfertaBorrada(resultado, "Publicación eliminada por moderación administrativa."),
            subastasCanceladas: resultado.subastasCanceladas,
            pujadoresAvisados: resultado.pujadoresAvisados
        });
    });

    // CERRAR AHORA LAS SUBASTAS VENCIDAS (normalmente lo hace solo cada minuto)
    router.post('/subastas/cerrar-vencidas', async (req, res) => {
        const cerradas = await cierreSubastas.cerrarVencidas();
        res.json({
            message: cerradas.length ? `Se cerraron ${cerradas.length} subasta(s) vencida(s).` : 'No había subastas vencidas por cerrar.',
            cerradas
        });
    });

    router.post('/categorias', async (req, res) => {
        const nombre = textoLimpio(req.body.nombreCategoria);
        if (!nombre) throw new ErrorHttp(400, "El nombre de la categoría es obligatorio.");
        const [resultado] = await db.query(
            'INSERT INTO CategoriasMateriales (NombreCategoria, Descripcion) VALUES (?, ?)',
            [nombre, req.body.descripcion || null]
        ).catch((err) => {
            console.error("❌ Error al crear categoría:", err.message);
            throw new ErrorHttp(500, "Error al registrar la nueva categoría o ya existe.");
        });
        res.json({ success: true, id: resultado.insertId, message: `Categoría '${nombre}' creada exitosamente.` });
    });

    return router;
}

module.exports = crearRutasAdmin;
