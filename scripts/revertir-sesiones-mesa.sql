-- Revierte la migración de sesiones de mesa (final de src/db/schema.sql).
-- Solo tiene sentido junto con volver el código a una versión sin sesiones:
-- "npm start" aplica schema.sql en cada arranque y las volvería a crear.
-- No toca pedidos, ventas ni facturas: solo quita la columna y las tablas nuevas.
BEGIN;
DROP INDEX IF EXISTS pedidos_por_sesion;
ALTER TABLE pedidos DROP COLUMN IF EXISTS id_sesion;
DROP TABLE IF EXISTS mesa_sesion_tokens;
DROP TABLE IF EXISTS mesa_sesiones;
COMMIT;
