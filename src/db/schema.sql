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
  umbral_alerta   INTEGER NOT NULL DEFAULT 0,
  -- Tasas en puntos básicos (1900 = 19 %). El precio ya incluye el impuesto.
  -- IVA aplica a la venta para llevar; INC (Art. 512-1 E.T.) al consumo en el sitio.
  -- Si la base ya existía, db.js agrega estas columnas (CREATE IF NOT EXISTS no altera).
  tasa_iva_bps         INTEGER NOT NULL DEFAULT 1900 CHECK (tasa_iva_bps BETWEEN 0 AND 10000),
  tasa_inc_bps         INTEGER NOT NULL DEFAULT 0 CHECK (tasa_inc_bps BETWEEN 0 AND 10000),
  es_bebida_alcoholica INTEGER NOT NULL DEFAULT 0 CHECK (es_bebida_alcoholica IN (0,1))
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
  fecha_hora      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Una venta anulada (vía su factura) no se borra; los reportes la excluyen.
  estado          TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','anulada'))
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

-- ---------------------------------------------------------------------------
-- Facturación (comprobante interno de venta; aún sin integración con la DIAN)
-- ---------------------------------------------------------------------------

-- Datos del negocio que emite. Una sola fila (id = 1); cada factura guarda una
-- copia de estos datos, así que editarlos no altera facturas ya emitidas.
CREATE TABLE IF NOT EXISTS emisor (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  razon_social      TEXT NOT NULL,
  nit               TEXT NOT NULL,
  dv                TEXT NOT NULL,
  direccion         TEXT NOT NULL,
  municipio         TEXT NOT NULL DEFAULT 'Floridablanca',
  departamento      TEXT NOT NULL DEFAULT 'Santander',
  telefono          TEXT,
  regimen           TEXT NOT NULL,
  titulo_documento  TEXT NOT NULL DEFAULT 'Comprobante de venta',
  leyenda_pie       TEXT NOT NULL
);

-- Consecutivo de facturación. Hoy hay una sola secuencia interna (sin prefijo
-- ni rango); los campos de resolución quedan listos para cuando exista una de
-- la DIAN. Solo una secuencia puede estar activa a la vez.
CREATE TABLE IF NOT EXISTS secuencias_factura (
  id_secuencia       INTEGER PRIMARY KEY AUTOINCREMENT,
  prefijo            TEXT,
  numero_actual      INTEGER NOT NULL DEFAULT 0,
  rango_desde        INTEGER NOT NULL DEFAULT 1,
  rango_hasta        INTEGER,
  resolucion_numero  TEXT,
  resolucion_fecha   TEXT,
  vigencia_hasta     TEXT,
  activa             INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS una_secuencia_activa ON secuencias_factura(activa) WHERE activa = 1;

-- Una factura por venta. Nunca se borra: se anula cambiando el estado.
CREATE TABLE IF NOT EXISTS facturas (
  id_factura           INTEGER PRIMARY KEY AUTOINCREMENT,
  id_secuencia         INTEGER NOT NULL REFERENCES secuencias_factura(id_secuencia),
  numero               INTEGER NOT NULL,
  numero_completo      TEXT NOT NULL,
  id_venta             INTEGER NOT NULL UNIQUE REFERENCES ventas(id_venta),
  id_mesa              INTEGER REFERENCES mesas(id_mesa),
  id_usuario           INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  fecha_expedicion     TEXT NOT NULL DEFAULT (datetime('now')),
  tipo_consumo         TEXT NOT NULL CHECK (tipo_consumo IN ('en_sitio','para_llevar')),
  emisor_razon_social  TEXT NOT NULL,
  emisor_nit           TEXT NOT NULL,
  emisor_dv            TEXT NOT NULL,
  emisor_direccion     TEXT NOT NULL,
  emisor_municipio     TEXT NOT NULL,
  emisor_departamento  TEXT NOT NULL,
  emisor_telefono      TEXT,
  emisor_regimen       TEXT NOT NULL,
  titulo_documento     TEXT NOT NULL,
  leyenda_pie          TEXT NOT NULL,
  cliente_nombre       TEXT NOT NULL DEFAULT 'Consumidor Final',
  cliente_tipo_doc     TEXT CHECK (cliente_tipo_doc IN ('CC','NIT','CE','PP')),
  cliente_num_doc      TEXT,
  cliente_dv           TEXT,
  forma_pago           TEXT NOT NULL CHECK (forma_pago IN ('efectivo','tarjeta_debito','tarjeta_credito','transferencia')),
  subtotal             INTEGER NOT NULL,
  total_iva            INTEGER NOT NULL,
  total_inc            INTEGER NOT NULL,
  total_impuestos      INTEGER NOT NULL,
  total                INTEGER NOT NULL,
  estado               TEXT NOT NULL DEFAULT 'emitida' CHECK (estado IN ('emitida','anulada')),
  motivo_anulacion     TEXT,
  fecha_anulacion      TEXT,
  id_usuario_anulacion INTEGER REFERENCES usuarios(id_usuario),
  UNIQUE (id_secuencia, numero)
);

-- Líneas de la factura con nombre, precio y tasas copiados al momento de emitir.
-- Valores en pesos enteros; tasas en puntos básicos.
CREATE TABLE IF NOT EXISTS factura_items (
  id_item          INTEGER PRIMARY KEY AUTOINCREMENT,
  id_factura       INTEGER NOT NULL REFERENCES facturas(id_factura) ON DELETE RESTRICT,
  id_producto      INTEGER NOT NULL REFERENCES productos(id_producto),
  descripcion      TEXT NOT NULL,
  cantidad         INTEGER NOT NULL,
  precio_unitario  INTEGER NOT NULL,
  base_linea       INTEGER NOT NULL,
  tasa_iva_bps     INTEGER NOT NULL,
  valor_iva        INTEGER NOT NULL,
  tasa_inc_bps     INTEGER NOT NULL,
  valor_inc        INTEGER NOT NULL,
  total_linea      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Facturación (comprobante interno de venta; aún sin integración con la DIAN)
-- ---------------------------------------------------------------------------

-- Datos del negocio que emite. Una sola fila (id = 1); cada factura guarda una
-- copia de estos datos, así que editarlos no altera facturas ya emitidas.
CREATE TABLE IF NOT EXISTS emisor (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  razon_social      TEXT NOT NULL,
  nit               TEXT NOT NULL,
  dv                TEXT NOT NULL,
  direccion         TEXT NOT NULL,
  municipio         TEXT NOT NULL DEFAULT 'Floridablanca',
  departamento      TEXT NOT NULL DEFAULT 'Santander',
  telefono          TEXT,
  regimen           TEXT NOT NULL,
  titulo_documento  TEXT NOT NULL DEFAULT 'Comprobante de venta',
  leyenda_pie       TEXT NOT NULL
);

-- Consecutivo de facturación. Hoy hay una sola secuencia interna (sin prefijo
-- ni rango); los campos de resolución quedan listos para cuando exista una de
-- la DIAN. Solo una secuencia puede estar activa a la vez.
CREATE TABLE IF NOT EXISTS secuencias_factura (
  id_secuencia       INTEGER PRIMARY KEY AUTOINCREMENT,
  prefijo            TEXT,
  numero_actual      INTEGER NOT NULL DEFAULT 0,
  rango_desde        INTEGER NOT NULL DEFAULT 1,
  rango_hasta        INTEGER,
  resolucion_numero  TEXT,
  resolucion_fecha   TEXT,
  vigencia_hasta     TEXT,
  activa             INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS una_secuencia_activa ON secuencias_factura(activa) WHERE activa = 1;

-- Una factura por venta. Nunca se borra: se anula cambiando el estado.
CREATE TABLE IF NOT EXISTS facturas (
  id_factura           INTEGER PRIMARY KEY AUTOINCREMENT,
  id_secuencia         INTEGER NOT NULL REFERENCES secuencias_factura(id_secuencia),
  numero               INTEGER NOT NULL,
  numero_completo      TEXT NOT NULL,
  id_venta             INTEGER NOT NULL UNIQUE REFERENCES ventas(id_venta),
  id_mesa              INTEGER REFERENCES mesas(id_mesa),
  id_usuario           INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  fecha_expedicion     TEXT NOT NULL DEFAULT (datetime('now')),
  tipo_consumo         TEXT NOT NULL CHECK (tipo_consumo IN ('en_sitio','para_llevar')),
  emisor_razon_social  TEXT NOT NULL,
  emisor_nit           TEXT NOT NULL,
  emisor_dv            TEXT NOT NULL,
  emisor_direccion     TEXT NOT NULL,
  emisor_municipio     TEXT NOT NULL,
  emisor_departamento  TEXT NOT NULL,
  emisor_telefono      TEXT,
  emisor_regimen       TEXT NOT NULL,
  titulo_documento     TEXT NOT NULL,
  leyenda_pie          TEXT NOT NULL,
  cliente_nombre       TEXT NOT NULL DEFAULT 'Consumidor Final',
  cliente_tipo_doc     TEXT CHECK (cliente_tipo_doc IN ('CC','NIT','CE','PP')),
  cliente_num_doc      TEXT,
  cliente_dv           TEXT,
  forma_pago           TEXT NOT NULL CHECK (forma_pago IN ('efectivo','tarjeta_debito','tarjeta_credito','transferencia')),
  subtotal             INTEGER NOT NULL,
  total_iva            INTEGER NOT NULL,
  total_inc            INTEGER NOT NULL,
  total_impuestos      INTEGER NOT NULL,
  total                INTEGER NOT NULL,
  estado               TEXT NOT NULL DEFAULT 'emitida' CHECK (estado IN ('emitida','anulada')),
  UNIQUE (id_secuencia, numero)
);

-- Líneas de la factura con nombre, precio y tasas copiados al momento de emitir.
-- Valores en pesos enteros; tasas en puntos básicos.
CREATE TABLE IF NOT EXISTS factura_items (
  id_item          INTEGER PRIMARY KEY AUTOINCREMENT,
  id_factura       INTEGER NOT NULL REFERENCES facturas(id_factura) ON DELETE RESTRICT,
  id_producto      INTEGER NOT NULL REFERENCES productos(id_producto),
  descripcion      TEXT NOT NULL,
  cantidad         INTEGER NOT NULL,
  precio_unitario  INTEGER NOT NULL,
  base_linea       INTEGER NOT NULL,
  tasa_iva_bps     INTEGER NOT NULL,
  valor_iva        INTEGER NOT NULL,
  tasa_inc_bps     INTEGER NOT NULL,
  valor_inc        INTEGER NOT NULL,
  total_linea      INTEGER NOT NULL
);
