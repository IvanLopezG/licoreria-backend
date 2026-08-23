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

function _registrar({ id_producto, tipo, motivo, cantidad, id_proveedor, id_venta, id_usuario }) {
  const stmt = db.prepare(`
    INSERT INTO movimientos_inventario (id_producto, tipo, motivo, cantidad, id_proveedor, id_venta, id_usuario)
    VALUES (@id_producto, @tipo, @motivo, @cantidad, @id_proveedor, @id_venta, @id_usuario)
  `);
  const info = stmt.run({
    id_producto,
    tipo,
    motivo,
    cantidad,
    id_proveedor: id_proveedor || null,
    id_venta: id_venta || null,
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

function registrarSalida({ id_producto, cantidad, motivo, id_usuario }) {
  return conTransaccion(() => {
    productoModel.ajustarStock(id_producto, -cantidad);
    return _registrar({ id_producto, tipo: "salida", motivo, cantidad, id_proveedor: null, id_usuario });
  });
}

function listar({ id_producto, desde, hasta, id_usuario } = {}) {
  let query = `
    SELECT m.*, u.nombre AS usuario_nombre, p.nombre AS producto_nombre
    FROM movimientos_inventario m
    JOIN usuarios u ON u.id_usuario = m.id_usuario
    JOIN productos p ON p.id_producto = m.id_producto
    WHERE 1 = 1
  `;
  const params = {};
  if (id_producto) {
    query += " AND m.id_producto = @id_producto";
    params.id_producto = id_producto;
  }
  if (desde) {
    query += " AND date(m.fecha_hora) >= date(@desde)";
    params.desde = desde;
  }
  if (hasta) {
    query += " AND date(m.fecha_hora) <= date(@hasta)";
    params.hasta = hasta;
  }
  // RF-18: filtrar el historial por usuario responsable.
  if (id_usuario) {
    query += " AND m.id_usuario = @id_usuario";
    params.id_usuario = id_usuario;
  }
  query += " ORDER BY m.fecha_hora DESC";
  return db.prepare(query).all(params);
}

// RF-16: descuenta stock por una venta (mesa o mostrador) reutilizando la
// misma validación de stock suficiente que registrarSalida (US-07), pero SIN
// abrir su propia transacción: quien llama (ventaModel) ya tiene un
// BEGIN/COMMIT abierto y esta llamada debe participar de esa transacción para
// que la venta y el descuento de inventario sean atómicos.
function descontarPorVenta({ id_producto, cantidad, id_venta, id_usuario }) {
  const producto = productoModel.buscarPorId(id_producto);
  if (!producto) {
    const err = new Error(`Producto ${id_producto} no encontrado.`);
    err.status = 404;
    throw err;
  }
  if (producto.stock_actual < cantidad) {
    const err = new Error(`No hay stock suficiente de "${producto.nombre}" para completar la venta.`);
    err.status = 400;
    throw err;
  }

  productoModel.ajustarStock(id_producto, -cantidad);
  return _registrar({ id_producto, tipo: "salida", motivo: "venta", cantidad, id_proveedor: null, id_venta, id_usuario });
}

module.exports = { registrarEntrada, registrarSalida, listar, descontarPorVenta };
