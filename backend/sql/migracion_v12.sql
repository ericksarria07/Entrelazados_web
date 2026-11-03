-- Migración v12: notificaciones (la campana del menú).
--
-- Ejecutar sobre la base existente, ANTES de reiniciar el servidor:
--   sudo mysql entrelazadosdb < backend/sql/migracion_v12.sql
--
-- Se puede ejecutar más de una vez sin daño (CREATE TABLE IF NOT EXISTS).
-- No cambia ni borra datos existentes. (No hay migración v11: esa versión
-- solo reorganizó el código.)

-- Cada aviso que recibe un usuario: te superaron en una puja, ganaste una
-- subasta, tu subasta terminó o fue cancelada, un trato cambió de estado, etc.
-- Si se borra la cuenta, sus notificaciones se borran con ella (CASCADE).
CREATE TABLE IF NOT EXISTS Notificaciones (
    NotificacionID INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioID INT NOT NULL,
    Tipo VARCHAR(30) NOT NULL,
    Titulo VARCHAR(120) NOT NULL,
    Mensaje VARCHAR(300) NOT NULL,
    Enlace VARCHAR(200) NULL,
    ReferenciaID INT NULL,
    EsLeida TINYINT(1) NOT NULL DEFAULT 0,
    FechaCreacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notificaciones_usuario FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID) ON DELETE CASCADE,
    INDEX idx_notificaciones_usuario (UsuarioID, EsLeida, FechaCreacion)
) ENGINE=InnoDB;

SELECT 'Migración v12 aplicada: tabla Notificaciones lista.' AS resultado;
