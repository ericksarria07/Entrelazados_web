-- Lo que Drizzle no genera desde db/esquema.ts (migración escrita a mano).

-- Búsqueda sin acentos: "latex" encuentra "Látex", como hacía la collation de MySQL
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint

-- Reemplazo de "ON UPDATE CURRENT_TIMESTAMP" de MySQL
CREATE OR REPLACE FUNCTION actualizar_fecha_actualizacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.fecha_actualizacion := now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_verificaciones_fecha_actualizacion
    BEFORE UPDATE ON verificaciones_antifraude
    FOR EACH ROW EXECUTE FUNCTION actualizar_fecha_actualizacion();
--> statement-breakpoint

-- Categorías iniciales del mercado
INSERT INTO categorias_materiales (nombre_categoria) VALUES
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
('Refuerzos, Cartón Fibra y Espuma EVA')
ON CONFLICT (nombre_categoria) DO NOTHING;
