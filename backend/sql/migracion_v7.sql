-- Migración para una base EXISTENTE creada con Entrelazadosfinalmysql.sql
-- Ejecutar una sola vez (por ejemplo en SmarterASP o en tu MySQL local).

-- 1) Permitir el rol de administrador.
--    El nombre de la restricción CHECK lo genera MySQL; normalmente es usuarios_chk_1.
--    Si da error, búscalo con:
--      SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
--      WHERE CONSTRAINT_SCHEMA = DATABASE();
ALTER TABLE Usuarios DROP CHECK usuarios_chk_1;
ALTER TABLE Usuarios ADD CONSTRAINT chk_usuarios_rol
    CHECK (TipoRol IN ('Proveedor', 'Emprendedor', 'Administrador', 'Admin'));

-- 2) Descripción opcional para las categorías creadas desde el panel de administrador.
ALTER TABLE CategoriasMateriales ADD COLUMN Descripcion VARCHAR(255) NULL;

-- 3) Para convertir un usuario existente en administrador:
-- UPDATE Usuarios SET TipoRol = 'Administrador' WHERE CorreoElectronico = 'tu_correo@ejemplo.com';
-- INSERT INTO Administradores (UsuarioID, NivelAcceso)
--   SELECT UsuarioID, 'SuperAdmin' FROM Usuarios WHERE CorreoElectronico = 'tu_correo@ejemplo.com';
