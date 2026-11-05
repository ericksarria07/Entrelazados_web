-- Migración v13: favoritos, alertas de búsqueda y descripción de las publicaciones.
--
-- Ejecutar sobre la base existente, ANTES de reiniciar el servidor:
--   sudo mysql entrelazadosdb < backend/sql/migracion_v13.sql
--
-- Se puede ejecutar más de una vez sin daño (IF NOT EXISTS y una revisión
-- antes de agregar la columna). No cambia ni borra datos existentes.

-- Publicaciones que un usuario guardó con el corazón. Si se borra la cuenta o la
-- publicación, el favorito se borra con ella (CASCADE).
CREATE TABLE IF NOT EXISTS Favoritos (
    UsuarioID INT NOT NULL,
    OfertaID INT NOT NULL,
    FechaGuardado DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (UsuarioID, OfertaID),
    CONSTRAINT fk_favoritos_usuario FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID) ON DELETE CASCADE,
    CONSTRAINT fk_favoritos_oferta FOREIGN KEY (OfertaID) REFERENCES Ofertas(OfertaID) ON DELETE CASCADE,
    -- Para avisar a quienes guardaron una publicación cuando baja de precio
    INDEX idx_favoritos_oferta (OfertaID)
) ENGINE=InnoDB;

-- "Avísame cuando publiquen...": palabra clave, categoría y precio máximo (cada uno opcional,
-- pero al menos la palabra o la categoría). Cuando se publica algo que cumple, llega una
-- notificación a la campana.
CREATE TABLE IF NOT EXISTS AlertasBusqueda (
    AlertaID INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioID INT NOT NULL,
    PalabraClave VARCHAR(60) NULL,
    CategoriaID INT NULL,
    PrecioMaximo DECIMAL(10,2) NULL,
    FechaCreacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_alertas_usuario FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID) ON DELETE CASCADE,
    CONSTRAINT fk_alertas_categoria FOREIGN KEY (CategoriaID) REFERENCES CategoriasMateriales(CategoriaID) ON DELETE CASCADE,
    INDEX idx_alertas_usuario (UsuarioID)
) ENGINE=InnoDB;

-- Descripción opcional de cada publicación (la puede redactar el asistente de IA)
SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ofertas' AND COLUMN_NAME = 'Descripcion');
SET @sql := IF(@existe = 0, 'ALTER TABLE Ofertas ADD COLUMN Descripcion VARCHAR(1000) NULL AFTER TituloMaterial', 'SELECT 1');
PREPARE paso FROM @sql;
EXECUTE paso;
DEALLOCATE PREPARE paso;

SELECT 'Migración v13 aplicada: Favoritos, AlertasBusqueda y Ofertas.Descripcion listos.' AS resultado;
