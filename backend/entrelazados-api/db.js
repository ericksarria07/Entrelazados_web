// ==========================================================================
// BASE DE DATOS
//
// Un solo "pool" de conexiones a MySQL para todo el servidor, en su versión
// con promesas: cada consulta se escribe con await.
//
//   const [filas] = await db.query('SELECT ... WHERE id = ?', [id]);
//
// Los ? se reemplazan de forma segura por los valores (nunca se pega texto
// del usuario dentro del SQL).
// ==========================================================================
const mysql = require('mysql2');

function crearPool(datos) {
    const pool = mysql.createPool({
        ...datos,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
    });
    pool.on('error', (err) => console.error('⚠️ Error en el pool de MySQL:', err.message));
    return pool.promise();
}

// Ejecuta fn(conn) dentro de una transacción: si fn termina bien se confirma
// (COMMIT); si lanza un error se deshace todo (ROLLBACK) y el error sigue su camino.
// La conexión siempre se devuelve al pool.
async function enTransaccion(db, fn) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const resultado = await fn(conn);
        await conn.commit();
        return resultado;
    } catch (err) {
        await conn.rollback().catch(() => { });
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = { crearPool, enTransaccion };
