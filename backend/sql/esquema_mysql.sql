-- Esquema MySQL de EntreLazados (basado en Entrelazadosfinalmysql.sql)
-- Cambios respecto al original, necesarios para que funcione el código actual:
--   * Usuarios.TipoRol acepta tambien Administrador / Admin (panel de administracion)
--   * CategoriasMateriales.Descripcion (formulario de nuevas categorias del admin)
-- Uso: crear la base, seleccionarla con USE y ejecutar este archivo.

CREATE TABLE Departamentos (
    DepartamentoID INT AUTO_INCREMENT PRIMARY KEY,
    NombreDepartamento VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE Usuarios (
    UsuarioID INT AUTO_INCREMENT PRIMARY KEY,
    CorreoElectronico VARCHAR(100) NOT NULL UNIQUE,
    ContrasenaHash VARCHAR(255) NOT NULL,
    TipoRol VARCHAR(20) NOT NULL CHECK (TipoRol IN ('Proveedor', 'Emprendedor', 'Administrador', 'Admin')),
    EstadoCuenta VARCHAR(20) DEFAULT 'Activo' CHECK (EstadoCuenta IN ('Activo', 'Inactivo', 'Suspendido')),
    FechaRegistro DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE PerfilesUsuarios (
    PerfilID INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioID INT NOT NULL UNIQUE,
    NombreRazonSocial VARCHAR(150) NOT NULL,
    TelefonoWhatsApp VARCHAR(20) NOT NULL,
    DepartamentoID INT NOT NULL,
    DireccionExacta VARCHAR(255) NULL,
    FotoPerfilURL VARCHAR(255) NULL,
    FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID) ON DELETE CASCADE,
    FOREIGN KEY (DepartamentoID) REFERENCES Departamentos(DepartamentoID)
) ENGINE=InnoDB;

CREATE TABLE Proveedores (
    ProveedorID INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioID INT NOT NULL UNIQUE,
    NumeroRUC VARCHAR(50) NULL,
    NombreComercial VARCHAR(150) NULL,
    DescripcionEmpresa TEXT NULL,
    TipoMateriaPrimaPrincipal VARCHAR(100) NULL,
    FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Emprendedores (
    EmprendedorID INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioID INT NOT NULL UNIQUE,
    NombreMarca VARCHAR(150) NULL,
    EspecialidadCalzado VARCHAR(100) NULL,
    CapacidadProduccionMensual INT NULL,
    FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Administradores (
    AdminID INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioID INT NOT NULL,
    NivelAcceso VARCHAR(50) DEFAULT 'SuperAdmin',
    FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID) ON DELETE CASCADE
);

CREATE TABLE VerificacionesAntifraude (
    VerificacionID INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioID INT NOT NULL UNIQUE,
    CorreoConfirmado TINYINT(1) DEFAULT 1,
    CedulaRucSubido TINYINT(1) DEFAULT 0,
    UbicacionConfirmada TINYINT(1) DEFAULT 0,
    WhatsAppVerificado TINYINT(1) DEFAULT 0,
    FotoIdentidadURL VARCHAR(255) NULL,
    FotoSelfieURL VARCHAR(255) NULL,
    EstadoFinal VARCHAR(20) DEFAULT 'Pendiente' CHECK (EstadoFinal IN ('Pendiente', 'Verificado', 'Rechazado')),
    FechaActualizacion DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE CategoriasMateriales (
    CategoriaID INT AUTO_INCREMENT PRIMARY KEY,
    NombreCategoria VARCHAR(50) NOT NULL UNIQUE,
    Descripcion VARCHAR(255) NULL
) ENGINE=InnoDB;

CREATE TABLE Ofertas (
    OfertaID INT AUTO_INCREMENT PRIMARY KEY,
    ProveedorID INT NOT NULL,
    TituloMaterial VARCHAR(150) NOT NULL,
    CategoriaID INT NOT NULL,
    Precio DECIMAL(10,2) NOT NULL,
    UnidadMedida VARCHAR(30) NOT NULL,
    DistanciaSimuladaKm INT NOT NULL,
    FechaPublicacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ProveedorID) REFERENCES Usuarios(UsuarioID),
    FOREIGN KEY (CategoriaID) REFERENCES CategoriasMateriales(CategoriaID)
) ENGINE=InnoDB;

CREATE TABLE FotosOfertas (
    FotoID INT AUTO_INCREMENT PRIMARY KEY,
    OfertaID INT NOT NULL,
    FotoURL VARCHAR(255) NOT NULL,
    EsPrincipal TINYINT(1) DEFAULT 0,
    FechaSubida DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (OfertaID) REFERENCES Ofertas(OfertaID) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Subastas (
    SubastaID INT AUTO_INCREMENT PRIMARY KEY,
    ProveedorID INT NOT NULL,
    -- Publicación de la que sale el lote (NULL si se creó sin publicación o si esta se borró)
    OfertaID INT NULL,
    CategoriaID INT NULL,
    TituloLote VARCHAR(150) NOT NULL,
    PrecioBase DECIMAL(10,2) NOT NULL,
    PrecioActual DECIMAL(10,2) NOT NULL,
    FechaInicio DATETIME DEFAULT CURRENT_TIMESTAMP,
    FechaFin DATETIME NOT NULL,
    -- 'Cancelada': se borró la publicación mientras la subasta seguía abierta
    Estado VARCHAR(15) DEFAULT 'Activa',
    CONSTRAINT chk_subastas_estado CHECK (Estado IN ('Activa', 'Finalizada', 'Cancelada')),
    FOREIGN KEY (ProveedorID) REFERENCES Usuarios(UsuarioID),
    CONSTRAINT fk_subastas_oferta FOREIGN KEY (OfertaID) REFERENCES Ofertas(OfertaID) ON DELETE SET NULL,
    CONSTRAINT fk_subastas_categoria FOREIGN KEY (CategoriaID) REFERENCES CategoriasMateriales(CategoriaID),
    -- El cierre automático busca cada minuto las subastas activas ya vencidas
    INDEX idx_subastas_estado_fin (Estado, FechaFin)
) ENGINE=InnoDB;

CREATE TABLE Pujas (
    PujaID INT AUTO_INCREMENT PRIMARY KEY,
    SubastaID INT NOT NULL,
    EmprendedorID INT NOT NULL,
    MontoPuja DECIMAL(10,2) NOT NULL,
    FechaPuja DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (SubastaID) REFERENCES Subastas(SubastaID) ON DELETE CASCADE,
    FOREIGN KEY (EmprendedorID) REFERENCES Usuarios(UsuarioID)
) ENGINE=InnoDB;

CREATE TABLE TratosCerrados (
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

CREATE TABLE MensajesChat (
    MensajeID INT AUTO_INCREMENT PRIMARY KEY,
    RemitenteID INT NOT NULL,
    DestinatarioID INT NOT NULL,
    ContenidoTexto TEXT NOT NULL,
    FechaEnvio DATETIME DEFAULT CURRENT_TIMESTAMP,
    EsEntregado TINYINT(1) DEFAULT 0,
    FechaEntrega DATETIME NULL,
    EsLeido TINYINT(1) DEFAULT 0,
    FechaLectura DATETIME NULL,
    FOREIGN KEY (RemitenteID) REFERENCES Usuarios(UsuarioID),
    FOREIGN KEY (DestinatarioID) REFERENCES Usuarios(UsuarioID)
) ENGINE=InnoDB;

ALTER TABLE Usuarios 
ADD COLUMN TokenRecuperacion VARCHAR(255) NULL,
ADD COLUMN ExpiracionToken DATETIME NULL;
ALTER TABLE Ofertas ADD COLUMN Fotos LONGTEXT;

INSERT INTO CategoriasMateriales (NombreCategoria) VALUES 
('Cuero Bovino / Vacuno'),
('Cuero Caprino / Ovino'),
('Gamuza y Carnaza'),
('Cuero Charol y Acabados Especiales'),
('Forros Textiles y Sintéticos'),
('Herrajes, Hebillas y Mosquetones'),
('Remaches, Ojalillos y Tachuelas'),
('Cierres, Cremalleras y Deslizadores'),
('Hilos Encerados y Trenzados'),
('Pegamentos, Cemento de Contacto y Látex'),
('Tintes, Pintura para Cantos y Selladores'),
('Ceras, Aceites y Acondicionadores'),
('Suelas, Tacones y Tapas (Calzado)'),
('Plantillas de Armado y Cambrillones'),
('Refuerzos, Cartón Fibra y Espuma EVA');
