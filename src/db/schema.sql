-- Esquema completo del modelo de datos (ver 08_Modelo_de_Datos_y_Arquitectura.docx)
-- Sprint 1 solo usa "usuarios" y "log_auditoria"; el resto queda creado
-- desde ya para que los siguientes sprints no tengan que rediseñar nada.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario      INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre          TEXT NOT NULL,
  usuario_login   TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  rol             TEXT NOT NULL CHECK (rol IN ('administrador','mesero','cajero')),
  activo          INTEGER NOT NULL DEFAULT 1,
  fecha_creacion  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categorias (
  id_categoria    INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre          TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS productos (
  id_producto     INTEGER PRIMARY KEY AUTOINCREMENT,
  id_categoria    INTEGER NOT NULL REFERENCES categorias(id_categoria),
  nombre          TEXT NOT NULL,
  unidad_medida   TEXT NOT NULL,
  precio          REAL NOT NULL,
  stock_actual    INTEGER NOT NULL DEFAULT 0,
  umbral_alerta   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proveedores (
  id_proveedor    INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre          TEXT NOT NULL,
  contacto        TEXT
);

CREATE TABLE IF NOT EXISTS producto_proveedor (
  id_producto     INTEGER NOT NULL REFERENCES productos(id_producto),
  id_proveedor    INTEGER NOT NULL REFERENCES proveedores(id_proveedor),
  PRIMARY KEY (id_producto, id_proveedor)
);

CREATE TABLE IF NOT EXISTS mesas (
  id_mesa         INTEGER PRIMARY KEY AUTOINCREMENT,
  numero          INTEGER NOT NULL UNIQUE,
  codigo_qr_token TEXT NOT NULL UNIQUE,
  estado          TEXT NOT NULL DEFAULT 'libre' CHECK (estado IN ('libre','ocupada'))
);

CREATE TABLE IF NOT EXISTS ventas (
  id_venta        INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo            TEXT NOT NULL CHECK (tipo IN ('mesa','mostrador')),
  id_mesa         INTEGER REFERENCES mesas(id_mesa),
  id_usuario      INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  total           REAL NOT NULL DEFAULT 0,
  fecha_hora      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pedidos (
  id_pedido       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_mesa         INTEGER NOT NULL REFERENCES mesas(id_mesa),
  id_venta        INTEGER REFERENCES ventas(id_venta),
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','entregado')),
  notificado      INTEGER NOT NULL DEFAULT 0,
  fecha_hora      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pedido_detalle (
  id_pedido_detalle INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pedido         INTEGER NOT NULL REFERENCES pedidos(id_pedido),
  id_producto       INTEGER NOT NULL REFERENCES productos(id_producto),
  cantidad          INTEGER NOT NULL,
  precio_unitario   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS venta_detalle (
  id_venta_detalle  INTEGER PRIMARY KEY AUTOINCREMENT,
  id_venta          INTEGER NOT NULL REFERENCES ventas(id_venta),
  id_pedido_detalle INTEGER REFERENCES pedido_detalle(id_pedido_detalle),
  id_producto       INTEGER NOT NULL REFERENCES productos(id_producto),
  cantidad          INTEGER NOT NULL,
  precio_unitario   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id_movimiento   INTEGER PRIMARY KEY AUTOINCREMENT,
  id_producto     INTEGER NOT NULL REFERENCES productos(id_producto),
  tipo            TEXT NOT NULL CHECK (tipo IN ('entrada','salida')),
  motivo          TEXT NOT NULL,
  cantidad        INTEGER NOT NULL,
  id_proveedor    INTEGER REFERENCES proveedores(id_proveedor),
  id_venta        INTEGER REFERENCES ventas(id_venta),
  id_usuario      INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  fecha_hora      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS log_auditoria (
  id_log          INTEGER PRIMARY KEY AUTOINCREMENT,
  id_usuario      INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  accion          TEXT NOT NULL CHECK (accion IN ('crear','editar','eliminar')),
  entidad         TEXT NOT NULL,
  id_entidad      INTEGER NOT NULL,
  fecha_hora      TEXT NOT NULL DEFAULT (datetime('now'))
);
