-- Migración v10: verificación del correo al registrarse, calificaciones de los tratos
-- y mensajes no leídos.
--
-- Ejecutar sobre la base existente, ANTES de reiniciar el servidor:
--   sudo mysql entrelazadosdb < backend/sql/migracion_v10.sql
--
-- Se puede ejecutar más de una vez: cada paso revisa primero si ya está hecho.
-- (Se usa PREPARE porque MySQL no tiene "ADD COLUMN IF NOT EXISTS".)

-- 1) Verificación del correo. Las cuentas que ya existen quedan como verificadas
--    (DEFAULT 1): solo las cuentas nuevas tienen que confirmar su correo.
SET @falta = (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'usuarios' AND COLUMN_NAME = 'CorreoVerificado');
SET @sql = IF(@falta,
    'ALTER TABLE Usuarios ADD COLUMN CorreoVerificado TINYINT(1) NOT NULL DEFAULT 1, ADD COLUMN TokenVerificacion VARCHAR(64) NULL, ADD COLUMN ExpiracionVerificacion DATETIME NULL',
    'DO 0');
PREPARE paso FROM @sql; EXECUTE paso; DEALLOCATE PREPARE paso;

-- 2) Calificaciones: al completar un trato, cada parte califica a la otra (1 a 5 estrellas).
CREATE TABLE IF NOT EXISTS Calificaciones (
    CalificacionID INT AUTO_INCREMENT PRIMARY KEY,
    TratoID INT NOT NULL,
    AutorID INT NOT NULL,
    CalificadoID INT NOT NULL,
    Puntuacion TINYINT NOT NULL,
    Comentario VARCHAR(300) NULL,
    FechaCalificacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_calificaciones_puntuacion CHECK (Puntuacion BETWEEN 1 AND 5),
    -- Una sola calificación por persona y trato
    CONSTRAINT uq_calificaciones_trato_autor UNIQUE (TratoID, AutorID),
    CONSTRAINT fk_calificaciones_trato FOREIGN KEY (TratoID) REFERENCES TratosCerrados(TratoID) ON DELETE CASCADE,
    CONSTRAINT fk_calificaciones_autor FOREIGN KEY (AutorID) REFERENCES Usuarios(UsuarioID),
    CONSTRAINT fk_calificaciones_calificado FOREIGN KEY (CalificadoID) REFERENCES Usuarios(UsuarioID),
    INDEX idx_calificaciones_calificado (CalificadoID)
) ENGINE=InnoDB;

-- 3) Mensajes no leídos: el contador del menú busca cada 30 s los mensajes
--    sin leer de cada usuario.
SET @falta = (SELECT COUNT(*) = 0 FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'mensajeschat' AND INDEX_NAME = 'idx_mensajes_no_leidos');
SET @sql = IF(@falta,
    'ALTER TABLE MensajesChat ADD INDEX idx_mensajes_no_leidos (DestinatarioID, EsLeido)',
    'DO 0');
PREPARE paso FROM @sql; EXECUTE paso; DEALLOCATE PREPARE paso;

-- 4) Los mensajes que ya existen se dan por leídos, para que nadie vea de golpe
--    un contador con toda su conversación antigua.
UPDATE MensajesChat SET EsLeido = 1, FechaLectura = COALESCE(FechaLectura, NOW()) WHERE EsLeido = 0;

-- 5) Cuentas con un correo que no es válido (p. ej. "erick@gmail", sin ".com"):
--    no pueden iniciar sesión. El administrador las corrige desde el panel
--    (botón "Corregir correo"). Esta consulta solo las lista.
SELECT UsuarioID, CorreoElectronico, TipoRol
FROM Usuarios
WHERE CorreoElectronico NOT REGEXP '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]{2,}$';
