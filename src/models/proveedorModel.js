const db = require("../db/db");

// Columnas que se escriben al crear y al editar.
const COLUMNAS = [
  "nombre", "contacto", "nit", "dv", "telefono", "correo", "direccion", "ciudad",
  "condicion_pago", "dias_credito", "notas", "activo",
];

async function crear(datos) {
  const { id_proveedor } = await db.uno(
    `INSERT INTO proveedores (${COLUMNAS.join(", ")})
     VALUES (${COLUMNAS.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING id_proveedor`,
    COLUMNAS.map((c) => datos[c] ?? null)
  );
  return buscarPorId(id_proveedor);
}

async function editar(id_proveedor, datos) {
  await db.ejecutar(
    `UPDATE proveedores
     SET ${COLUMNAS.map((c, i) => `${c} = $${i + 1}`).join(", ")}
     WHERE id_proveedor = $${COLUMNAS.length + 1}`,
    [...COLUMNAS.map((c) => datos[c] ?? null), id_proveedor]
  );
  return buscarPorId(id_proveedor);
}

function buscarPorId(id_proveedor) {
  return db.uno("SELECT * FROM proveedores WHERE id_proveedor = $1", [id_proveedor]);
}

// COLLATE "C": mismo orden binario que SQLite.
function listar() {
  return db.todos('SELECT * FROM proveedores ORDER BY nombre COLLATE "C", id_proveedor');
}

async function asociarProducto(id_proveedor, id_producto) {
  await db.ejecutar(
    "INSERT INTO producto_proveedor (id_producto, id_proveedor) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [id_producto, id_proveedor]
  );
}

// Devuelve cuántas filas quitó (0 si no estaban asociados).
async function quitarProducto(id_proveedor, id_producto) {
  const resultado = await db.ejecutar(
    "DELETE FROM producto_proveedor WHERE id_producto = $1 AND id_proveedor = $2",
    [id_producto, id_proveedor]
  );
  return resultado.rowCount;
}

function listarProductos(id_proveedor) {
  return db.todos(
    `SELECT p.*
     FROM producto_proveedor pp
     JOIN productos p ON p.id_producto = pp.id_producto
     WHERE pp.id_proveedor = $1
     ORDER BY p.nombre COLLATE "C", p.id_producto`,
    [id_proveedor]
  );
}

module.exports = { crear, editar, buscarPorId, listar, asociarProducto, quitarProducto, listarProductos };
