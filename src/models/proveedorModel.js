const db = require("../db/db");

async function crear({ nombre, contacto }) {
  const { id_proveedor } = await db.uno(
    "INSERT INTO proveedores (nombre, contacto) VALUES ($1, $2) RETURNING id_proveedor",
    [nombre, contacto || null]
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

module.exports = { crear, buscarPorId, listar, asociarProducto, listarProductos };
