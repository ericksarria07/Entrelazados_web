// Datos base de la base de pruebas (los mismos que cargaba backend/pruebas/cargar_esquema.js):
//   * 3 departamentos
//   * admin@prueba.com / Admin123! (Administrador, contraseña con bcrypt)
//   * antiguo@prueba.com / clave_vieja (contraseña en texto plano, para probar que se migra a bcrypt)
// Las 15 categorías ya las crea la migración 0001_extras.sql.
import bcrypt from 'bcryptjs';

export async function sembrar(pool) {
    const admin = bcrypt.hashSync('Admin123!', 10);
    await pool.query(`INSERT INTO departamentos (nombre_departamento) VALUES ('Managua'), ('León'), ('Masaya')`);

    const { rows: [a] } = await pool.query(
        `INSERT INTO usuarios (correo_electronico, contrasena_hash, tipo_rol) VALUES ('admin@prueba.com', $1, 'Administrador') RETURNING usuario_id`,
        [admin]
    );
    await pool.query(
        `INSERT INTO perfiles_usuarios (usuario_id, nombre_razon_social, telefono_whatsapp, departamento_id) VALUES ($1, 'Admin de Prueba', '88880000', 1)`,
        [a.usuario_id]
    );
    await pool.query('INSERT INTO administradores (usuario_id) VALUES ($1)', [a.usuario_id]);

    const { rows: [v] } = await pool.query(
        `INSERT INTO usuarios (correo_electronico, contrasena_hash, tipo_rol) VALUES ('antiguo@prueba.com', 'clave_vieja', 'Emprendedor') RETURNING usuario_id`
    );
    await pool.query(
        `INSERT INTO perfiles_usuarios (usuario_id, nombre_razon_social, telefono_whatsapp, departamento_id) VALUES ($1, 'Taller Antiguo', '88881111', 2)`,
        [v.usuario_id]
    );
    await pool.query(`INSERT INTO emprendedores (usuario_id, nombre_marca) VALUES ($1, 'Taller Antiguo')`, [v.usuario_id]);
}
