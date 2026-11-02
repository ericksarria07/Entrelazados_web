const [, , backend, esquema, pass] = process.argv;
const mysql = require(backend + '/node_modules/mysql2');
const fs = require('fs');
const bcrypt = require(backend + '/node_modules/bcrypt');
const c = mysql.createConnection({ host: 'localhost', user: 'entrelazados_pruebas', password: pass, database: 'entrelazados_pruebas', multipleStatements: true });
const sql = fs.readFileSync(esquema, 'utf8');
const admin = bcrypt.hashSync('Admin123!', 10);
const datos = `
INSERT INTO Departamentos (NombreDepartamento) VALUES ('Managua'), ('León'), ('Masaya');
-- Administrador (contraseña cifrada con bcrypt)
INSERT INTO Usuarios (CorreoElectronico, ContrasenaHash, TipoRol) VALUES ('admin@prueba.com', '${admin}', 'Administrador');
INSERT INTO PerfilesUsuarios (UsuarioID, NombreRazonSocial, TelefonoWhatsApp, DepartamentoID) VALUES (LAST_INSERT_ID(), 'Admin de Prueba', '88880000', 1);
INSERT INTO Administradores (UsuarioID) SELECT UsuarioID FROM Usuarios WHERE CorreoElectronico='admin@prueba.com';
-- Usuario ANTIGUO con contraseña en texto plano (para probar la migración automática a bcrypt)
INSERT INTO Usuarios (CorreoElectronico, ContrasenaHash, TipoRol) VALUES ('antiguo@prueba.com', 'clave_vieja', 'Emprendedor');
INSERT INTO PerfilesUsuarios (UsuarioID, NombreRazonSocial, TelefonoWhatsApp, DepartamentoID) VALUES (LAST_INSERT_ID(), 'Taller Antiguo', '88881111', 2);
INSERT INTO Emprendedores (UsuarioID, NombreMarca) SELECT UsuarioID, 'Taller Antiguo' FROM Usuarios WHERE CorreoElectronico='antiguo@prueba.com';
`;
c.query(sql + datos, (err) => {
  if (err) { console.error('ERROR:', err.message); process.exit(1); }
  c.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = "entrelazados_pruebas"', (e, r) => {
    console.log('tablas:', r.length, '| ', r.map(x => x.TABLE_NAME).join(', '));
    c.end();
  });
});
