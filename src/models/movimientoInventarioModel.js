const db = require("../db/db");
const productoModel = require("./productoModel");

// node:sqlite (DatabaseSync) no trae un helper db.transaction() como
// better-sqlite3; se envuelve BEGIN/COMMIT/ROLLBACK a mano.
function conTransaccion(fn) {
  db.exec("BEGIN");
  try {
    const resultado = fn();
    db.exec("COMMIT");
    return resultado;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function _registrar({ id_producto, tipo, motivo, cantidad, id_proveedor, id_usuario }) {
  const stmt = db.prepare(`
    INSERT INTO movimientos_inventario (id_producto, tipo, motivo, cantidad, id_proveedor, id_usuario)
    VALUES (@id_producto, @tipo, @motivo, @cantidad, @id_proveedor, @id_usuario)
  `);
  const info = stmt.run({
    id_producto,
    tipo,
    motivo,
    cantidad,
    id_proveedor: id_proveedor || null,
    id_usuario,
  });
  return buscarPorId(info.lastInsertRowid);
}

function buscarPorId(id_movimiento) {
  return db
    .prepare(
      `
    SELECT m.*, u.nombre AS usuario_nombre, p.nombre AS producto_nombre
    FROM movimientos_inventario m
    JOIN usuarios u ON u.id_usuario = m.id_usuario
    JOIN productos p ON p.id_producto = m.id_producto
    WHERE m.id_movimiento = ?
  `
    )
    .get(id_movimiento);
}

function registrarEntrada({ id_producto, cantidad, id_proveedor, id_usuario }) {
  return conTransaccion(() => {
    productoModel.ajustarStock(id_producto, cantidad);
    return _registrar({ id_producto, tipo: "entrada", motivo: "compra", cantidad, id_proveedor, id_usuario });
  });
}

module.exports = { registrarEntrada };
