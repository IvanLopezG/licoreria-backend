const db = require("../db/db");

function crear({ nombre, contacto }) {
  const stmt = db.prepare("INSERT INTO proveedores (nombre, contacto) VALUES (@nombre, @contacto)");
  const info = stmt.run({ nombre, contacto: contacto || null });
  return buscarPorId(info.lastInsertRowid);
}

function buscarPorId(id_proveedor) {
  return db.prepare("SELECT * FROM proveedores WHERE id_proveedor = ?").get(id_proveedor);
}

function listar() {
  return db.prepare("SELECT * FROM proveedores ORDER BY nombre").all();
}

function asociarProducto(id_proveedor, id_producto) {
  db.prepare("INSERT OR IGNORE INTO producto_proveedor (id_producto, id_proveedor) VALUES (?, ?)").run(
    id_producto,
    id_proveedor
  );
}

function listarProductos(id_proveedor) {
  return db
    .prepare(
      `
    SELECT p.*
    FROM producto_proveedor pp
    JOIN productos p ON p.id_producto = pp.id_producto
    WHERE pp.id_proveedor = ?
    ORDER BY p.nombre
  `
    )
    .all(id_proveedor);
}

module.exports = { crear, buscarPorId, listar, asociarProducto, listarProductos };
