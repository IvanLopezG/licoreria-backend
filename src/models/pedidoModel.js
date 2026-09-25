const db = require("../db/db");
const mesaModel = require("./mesaModel");

// node:sqlite (DatabaseSync) no trae db.transaction(); se envuelve
// BEGIN/COMMIT/ROLLBACK a mano, igual que en movimientoInventarioModel.js.
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

const stmtDetalle = db.prepare(`
  INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario)
  VALUES (@id_pedido, @id_producto, @cantidad, @precio_unitario)
`);

const stmtItemsPedido = db.prepare(`
  SELECT pd.*, p.nombre AS producto_nombre
  FROM pedido_detalle pd
  JOIN productos p ON p.id_producto = pd.id_producto
  WHERE pd.id_pedido = ?
`);

// RF-12: el pedido queda asociado a la mesa del QR escaneado y, si la mesa
// estaba libre, pasa a ocupada; todo en una sola transacción.
function crear({ id_mesa, items }) {
  return conTransaccion(() => {
    const infoPedido = db.prepare("INSERT INTO pedidos (id_mesa) VALUES (?)").run(id_mesa);
    const id_pedido = infoPedido.lastInsertRowid;

    for (const item of items) {
      stmtDetalle.run({
        id_pedido,
        id_producto: item.id_producto,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
      });
    }

    mesaModel.actualizarEstado(id_mesa, "ocupada");

    return buscarPorId(id_pedido);
  });
}

function buscarPorId(id_pedido) {
  const pedido = db
    .prepare(
      `
    SELECT ped.*, m.numero AS mesa_numero
    FROM pedidos ped
    JOIN mesas m ON m.id_mesa = ped.id_mesa
    WHERE ped.id_pedido = ?
  `
    )
    .get(id_pedido);
  if (!pedido) return null;
  return { ...pedido, items: stmtItemsPedido.all(id_pedido) };
}

function listar({ estado, id_mesa } = {}) {
  let query = `
    SELECT ped.*, m.numero AS mesa_numero
    FROM pedidos ped
    JOIN mesas m ON m.id_mesa = ped.id_mesa
    WHERE 1 = 1
  `;
  const params = {};
  if (estado) {
    query += " AND ped.estado = @estado";
    params.estado = estado;
  }
  if (id_mesa) {
    query += " AND ped.id_mesa = @id_mesa";
    params.id_mesa = id_mesa;
  }
  query += " ORDER BY ped.fecha_hora ASC";

  return db
    .prepare(query)
    .all(params)
    .map((pedido) => ({ ...pedido, items: stmtItemsPedido.all(pedido.id_pedido) }));
}

function marcarEntregado(id_pedido) {
  db.prepare("UPDATE pedidos SET estado = 'entregado' WHERE id_pedido = ?").run(id_pedido);
  return buscarPorId(id_pedido);
}

const stmtBorrarDetalle = db.prepare("DELETE FROM pedido_detalle WHERE id_pedido = ?");
// Un pedido reabierto por anulación de factura sigue referenciado desde las
// líneas de la venta anulada; se suelta esa referencia para poder borrarlo.
const stmtSoltarDeVentas = db.prepare(`
  UPDATE venta_detalle SET id_pedido_detalle = NULL
  WHERE id_pedido_detalle IN (SELECT id_pedido_detalle FROM pedido_detalle WHERE id_pedido = ?)
`);
const stmtBorrarPedido = db.prepare("DELETE FROM pedidos WHERE id_pedido = ?");

// No hay ON DELETE CASCADE en el esquema: se borra el detalle antes que el
// pedido, en la misma transacción, para no dejar líneas huérfanas.
function cancelar(id_pedido) {
  return conTransaccion(() => {
    stmtSoltarDeVentas.run(id_pedido);
    stmtBorrarDetalle.run(id_pedido);
    stmtBorrarPedido.run(id_pedido);
  });
}

module.exports = { crear, buscarPorId, listar, marcarEntregado, cancelar };
