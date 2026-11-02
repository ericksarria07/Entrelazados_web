-- Migración v8: fotos en disco y cierre automático de subastas.
-- Ejecutar UNA sola vez sobre la base existente, ANTES de reiniciar el servidor:
--   mysql -u entrelazados_app -p entrelazadosdb < backend/sql/migracion_v8.sql
-- (el CREATE INDEX da error si se ejecuta dos veces; ese error se puede ignorar)

-- 1) Tabla de fotos (ya existe en el esquema original; se crea solo si falta).
--    Cada fila apunta a un archivo en entrelazados-api/uploads/ofertas/.
CREATE TABLE IF NOT EXISTS FotosOfertas (
    FotoID INT AUTO_INCREMENT PRIMARY KEY,
    OfertaID INT NOT NULL,
    FotoURL VARCHAR(255) NOT NULL,
    EsPrincipal TINYINT(1) DEFAULT 0,
    FechaSubida DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (OfertaID) REFERENCES Ofertas(OfertaID) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 2) Tabla donde quedan registrados los ganadores de cada subasta (ya existe en el esquema original).
CREATE TABLE IF NOT EXISTS TratosCerrados (
    TratoID INT AUTO_INCREMENT PRIMARY KEY,
    ProveedorID INT NOT NULL,
    EmprendedorID INT NOT NULL,
    TipoOrigen VARCHAR(20) NOT NULL CHECK (TipoOrigen IN ('Oferta', 'Subasta', 'AcuerdoDirecto')),
    OrigenID INT NULL,
    DescripcionResumen VARCHAR(255) NOT NULL,
    MontoTotal DECIMAL(10,2) NOT NULL,
    EstadoTrato VARCHAR(20) DEFAULT 'Completado' CHECK (EstadoTrato IN ('Pendiente', 'EnProceso', 'Completado', 'Cancelado')),
    FechaCierre DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ProveedorID) REFERENCES Usuarios(UsuarioID),
    FOREIGN KEY (EmprendedorID) REFERENCES Usuarios(UsuarioID)
) ENGINE=InnoDB;

-- 3) Índice para que el cierre automático (cada minuto) encuentre rápido las subastas vencidas.
CREATE INDEX idx_subastas_estado_fin ON Subastas (Estado, FechaFin);
