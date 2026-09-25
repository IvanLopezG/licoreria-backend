const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "licoreria.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
db.exec(schema);

// CREATE TABLE IF NOT EXISTS no agrega columnas nuevas a una tabla que ya
// existe (p. ej. la base de producción). Estas columnas se agregaron después
// del esquema original; si faltan, se crean con el mismo DEFAULT de schema.sql.
const COLUMNAS_AGREGADAS = [
  ["productos", "tasa_iva_bps", "INTEGER NOT NULL DEFAULT 1900 CHECK (tasa_iva_bps BETWEEN 0 AND 10000)"],
  ["productos", "tasa_inc_bps", "INTEGER NOT NULL DEFAULT 0 CHECK (tasa_inc_bps BETWEEN 0 AND 10000)"],
  ["productos", "es_bebida_alcoholica", "INTEGER NOT NULL DEFAULT 0 CHECK (es_bebida_alcoholica IN (0,1))"],
  ["ventas", "estado", "TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','anulada'))"],
  ["facturas", "motivo_anulacion", "TEXT"],
  ["facturas", "fecha_anulacion", "TEXT"],
  ["facturas", "id_usuario_anulacion", "INTEGER REFERENCES usuarios(id_usuario)"],
];

for (const [tabla, columna, definicion] of COLUMNAS_AGREGADAS) {
  const existe = db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === columna);
  if (!existe) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }
}

module.exports = db;
