const db = require("../db/db");
const movimientoInventarioModel = require("./movimientoInventarioModel");

// node:sqlite (DatabaseSync) no trae db.transaction(); se envuelve
// BEGIN/COMMIT/ROLLBACK a mano, igual que en movimientoInventarioModel.js
// y pedidoModel.js. Si algo falla a mitad de camino (crear venta, copiar
// líneas, marcar pedidos, liberar mesa), todo se revierte junto.
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

const stmtCrearVenta = db.prepare(`
  INSERT INTO ventas (tipo, id_mesa, id_usuario, total) VALUES (@tipo, @id_mesa, @id_usuario, 0)
`);

const stmtCopiarLinea = db.prepare(`
  INSERT INTO venta_detalle (id_venta, id_pedido_detalle, id_producto, cantidad, precio_unitario)
  VALUES (@id_venta, @id_pedido_detalle, @id_producto, @cantidad, @precio_unitario)
`);

const stmtPedidosAbiertosPorMesa = db.prepare(`
  SELECT * FROM pedidos WHERE id_mesa = ? AND id_venta IS NULL
`);

const stmtDetallePorPedido = db.prepare(`
  SELECT * FROM pedido_detalle WHERE id_pedido = ?
`);

const stmtMarcarPedidoFacturado = db.prepare(`
  UPDATE pedidos SET id_venta = ?, estado = 'entregado' WHERE id_pedido = ?
`);

const stmtActualizarTotal = db.prepare("UPDATE ventas SET total = ? WHERE id_venta = ?");
const stmtLiberarMesa = db.prepare("UPDATE mesas SET estado = 'libre' WHERE id_mesa = ?");

// US-14 / RF-14: consolida todos los pedidos abiertos (id_venta IS NULL) de
// la mesa en una única venta, copiando sus líneas a venta_detalle.
function cerrarCuentaMesa(id_mesa, id_usuario) {
  return conTransaccion(() => {
    const pedidos = stmtPedidosAbiertosPorMesa.all(id_mesa);
    if (pedidos.length === 0) {
      const err = new Error("La mesa no tiene pedidos pendientes de cobro.");
      err.status = 400;
      throw err;
    }

    const id_venta = stmtCrearVenta.run({ tipo: "mesa", id_mesa, id_usuario }).lastInsertRowid;

    let total = 0;
    for (const pedido of pedidos) {
      const lineas = stmtDetallePorPedido.all(pedido.id_pedido);
      for (const linea of lineas) {
        stmtCopiarLinea.run({
          id_venta,
          id_pedido_detalle: linea.id_pedido_detalle,
          id_producto: linea.id_producto,
          cantidad: linea.cantidad,
          precio_unitario: linea.precio_unitario,
        });
        total += linea.cantidad * linea.precio_unitario;

        // RF-16: el descuento de stock ocurre en la misma transacción que la
        // venta; si no hay stock suficiente, todo el cierre de cuenta se revierte.
        movimientoInventarioModel.descontarPorVenta({
          id_producto: linea.id_producto,
          cantidad: linea.cantidad,
          id_venta,
          id_usuario,
        });
      }
      stmtMarcarPedidoFacturado.run(id_venta, pedido.id_pedido);
    }

    stmtActualizarTotal.run(total, id_venta);
    stmtLiberarMesa.run(id_mesa);

    return buscarPorId(id_venta);
  });
}

// US-15 / RF-15: venta sin mesa asociada; queda igual que una venta por mesa
// salvo por id_mesa = null (mismo esquema, mismo venta_detalle, sin pedido).
function crearVentaMostrador({ items, id_usuario }) {
  return conTransaccion(() => {
    const id_venta = stmtCrearVenta.run({ tipo: "mostrador", id_mesa: null, id_usuario }).lastInsertRowid;

    let total = 0;
    for (const item of items) {
      stmtCopiarLinea.run({
        id_venta,
        id_pedido_detalle: null,
        id_producto: item.id_producto,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
      });
      total += item.cantidad * item.precio_unitario;

      // RF-16: mismo descuento atómico que en el cierre de cuenta por mesa.
      movimientoInventarioModel.descontarPorVenta({
        id_producto: item.id_producto,
        cantidad: item.cantidad,
        id_venta,
        id_usuario,
      });
    }

    stmtActualizarTotal.run(total, id_venta);

    return buscarPorId(id_venta);
  });
}

function buscarPorId(id_venta) {
  const venta = db
    .prepare(
      `
    SELECT v.*, u.nombre AS usuario_nombre, m.numero AS mesa_numero
    FROM ventas v
    JOIN usuarios u ON u.id_usuario = v.id_usuario
    LEFT JOIN mesas m ON m.id_mesa = v.id_mesa
    WHERE v.id_venta = ?
  `
    )
    .get(id_venta);
  if (!venta) return null;

  const detalle = db
    .prepare(
      `
    SELECT vd.*, p.nombre AS producto_nombre
    FROM venta_detalle vd
    JOIN productos p ON p.id_producto = vd.id_producto
    WHERE vd.id_venta = ?
  `
    )
    .all(id_venta);

  return { ...venta, detalle };
}

module.exports = { cerrarCuentaMesa, crearVentaMostrador, buscarPorId };
