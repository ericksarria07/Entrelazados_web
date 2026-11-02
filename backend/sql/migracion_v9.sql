-- Migración v9: cada subasta queda ligada a su publicación (OfertaID) y a su categoría,
-- y las subastas pueden quedar 'Cancelada' (cuando se borra la publicación).
--
-- Ejecutar sobre la base existente, ANTES de reiniciar el servidor:
--   mysql -u entrelazados_app -p entrelazadosdb < backend/sql/migracion_v9.sql
--
-- Se puede ejecutar más de una vez: cada paso revisa primero si ya está hecho.
-- (Se usa PREPARE porque MySQL no tiene "ADD COLUMN IF NOT EXISTS".)

-- 1) Columnas nuevas: la publicación de la que sale el lote y su categoría.
--    OfertaID queda NULL si el lote se creó sin publicación o si la publicación se borró.
SET @falta = (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'subastas' AND COLUMN_NAME = 'OfertaID');
SET @sql = IF(@falta,
    'ALTER TABLE Subastas ADD COLUMN OfertaID INT NULL AFTER ProveedorID, ADD COLUMN CategoriaID INT NULL AFTER OfertaID',
    'DO 0');
PREPARE paso FROM @sql; EXECUTE paso; DEALLOCATE PREPARE paso;

-- 2) Llaves foráneas. Al borrar la publicación, la subasta se conserva (su OfertaID pasa a NULL):
--    el servidor ya la canceló antes si seguía abierta (ver eliminarOferta en index.js).
SET @falta = (SELECT COUNT(*) = 0 FROM information_schema.TABLE_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_subastas_oferta');
SET @sql = IF(@falta,
    'ALTER TABLE Subastas ADD CONSTRAINT fk_subastas_oferta FOREIGN KEY (OfertaID) REFERENCES Ofertas(OfertaID) ON DELETE SET NULL',
    'DO 0');
PREPARE paso FROM @sql; EXECUTE paso; DEALLOCATE PREPARE paso;

SET @falta = (SELECT COUNT(*) = 0 FROM information_schema.TABLE_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_subastas_categoria');
SET @sql = IF(@falta,
    'ALTER TABLE Subastas ADD CONSTRAINT fk_subastas_categoria FOREIGN KEY (CategoriaID) REFERENCES CategoriasMateriales(CategoriaID)',
    'DO 0');
PREPARE paso FROM @sql; EXECUTE paso; DEALLOCATE PREPARE paso;

-- 3) Nuevo estado 'Cancelada'. La regla vieja (solo 'Activa' y 'Finalizada') no tiene
--    nombre fijo (MySQL la llamó subastas_chk_N), así que se busca y se reemplaza.
SET @vieja = (SELECT cc.CONSTRAINT_NAME
              FROM information_schema.CHECK_CONSTRAINTS cc
              JOIN information_schema.TABLE_CONSTRAINTS tc
                ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
              WHERE cc.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(tc.TABLE_NAME) = 'subastas'
                AND cc.CHECK_CLAUSE LIKE '%Finalizada%' AND cc.CHECK_CLAUSE NOT LIKE '%Cancelada%'
              LIMIT 1);
SET @sql = IF(@vieja IS NULL, 'DO 0', CONCAT('ALTER TABLE Subastas DROP CHECK `', @vieja, '`'));
PREPARE paso FROM @sql; EXECUTE paso; DEALLOCATE PREPARE paso;

SET @falta = (SELECT COUNT(*) = 0 FROM information_schema.TABLE_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_subastas_estado');
SET @sql = IF(@falta,
    'ALTER TABLE Subastas ADD CONSTRAINT chk_subastas_estado CHECK (Estado IN (''Activa'', ''Finalizada'', ''Cancelada''))',
    'DO 0');
PREPARE paso FROM @sql; EXECUTE paso; DEALLOCATE PREPARE paso;

-- 4) Ligar las subastas que ya existen con su publicación. Hasta ahora cada publicación
--    creaba "Lote Subasta: <título>" con el mismo proveedor y el mismo precio base.
UPDATE Subastas s
JOIN Ofertas o
  ON o.ProveedorID = s.ProveedorID
 AND s.TituloLote = CONCAT('Lote Subasta: ', o.TituloMaterial)
 AND s.PrecioBase = o.Precio
SET s.OfertaID = o.OfertaID, s.CategoriaID = o.CategoriaID
WHERE s.OfertaID IS NULL;

-- 5) Subastas abiertas cuya publicación ya se había borrado (el error que corrige esta versión).
--    Si nadie pujó, se cancelan. Si tienen pujas se dejan abiertas para no quitarle el lote
--    a quien va ganando; la consulta de abajo las lista para revisarlas.
UPDATE Subastas s
SET s.Estado = 'Cancelada'
WHERE s.Estado = 'Activa' AND s.OfertaID IS NULL AND s.TituloLote LIKE 'Lote Subasta:%'
  AND NOT EXISTS (SELECT 1 FROM Pujas p WHERE p.SubastaID = s.SubastaID);

SELECT s.SubastaID, s.TituloLote, s.FechaFin,
       (SELECT COUNT(*) FROM Pujas p WHERE p.SubastaID = s.SubastaID) AS Pujas
FROM Subastas s
WHERE s.Estado = 'Activa' AND s.OfertaID IS NULL AND s.TituloLote LIKE 'Lote Subasta:%';
