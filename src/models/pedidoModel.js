const db = require("../db/db");
const mesaModel = require("./mesaModel");

function itemsDelPedido(id_pedido, cx = db) {
  return cx.todos(
    `SELECT pd.*, p.nombre AS producto_nombre
     FROM pedido_detalle pd
     JOIN productos p ON p.id_producto = pd.id_producto
     WHERE pd.id_pedido = $1
     ORDER BY pd.id_pedido_detalle`,
    [id_pedido]
  );
}

// RF-12: el pedido queda asociado a la mesa del QR escaneado y, si la mesa
// estaba libre, pasa a ocupada; todo en una sola transacción.
function crear({ id_mesa, items }) {
  return db.conTransaccion(async (cx) => {
    const { id_pedido } = await cx.uno("INSERT INTO pedidos (id_mesa) VALUES ($1) RETURNING id_pedido", [id_mesa]);

    for (const item of items) {
      await cx.ejecutar(
        `INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [id_pedido, item.id_producto, item.cantidad, item.precio_unitario]
      );
    }

    await mesaModel.actualizarEstado(id_mesa, "ocupada", cx);

    return buscarPorId(id_pedido, cx);
  });
}

async function buscarPorId(id_pedido, cx = db) {
  const pedido = await cx.uno(
    `SELECT ped.*, m.numero AS mesa_numero
     FROM pedidos ped
     JOIN mesas m ON m.id_mesa = ped.id_mesa
     WHERE ped.id_pedido = $1`,
    [id_pedido]
  );
  if (!pedido) return null;
  return { ...pedido, items: await itemsDelPedido(id_pedido, cx) };
}

async function listar({ estado, id_mesa } = {}) {
  const f = db.filtros();
  if (estado) f.agregar("ped.estado = ?", estado);
  if (id_mesa) f.agregar("ped.id_mesa = ?", id_mesa);

  const pedidos = await db.todos(
    `SELECT ped.*, m.numero AS mesa_numero
     FROM pedidos ped
     JOIN mesas m ON m.id_mesa = ped.id_mesa
     WHERE 1 = 1${f.where()}
     ORDER BY ped.fecha_hora ASC, ped.id_pedido ASC`,
    f.params
  );
  for (const pedido of pedidos) pedido.items = await itemsDelPedido(pedido.id_pedido);
  return pedidos;
}

async function marcarEntregado(id_pedido) {
  await db.ejecutar("UPDATE pedidos SET estado = 'entregado' WHERE id_pedido = $1", [id_pedido]);
  return buscarPorId(id_pedido);
}

// No hay ON DELETE CASCADE en el esquema: se borra el detalle antes que el
// pedido, en la misma transacción, para no dejar líneas huérfanas.
function cancelar(id_pedido) {
  return db.conTransaccion(async (cx) => {
    // Un pedido reabierto por anulación de factura sigue referenciado desde las
    // líneas de la venta anulada; se suelta esa referencia para poder borrarlo.
    await cx.ejecutar(
      `UPDATE venta_detalle SET id_pedido_detalle = NULL
       WHERE id_pedido_detalle IN (SELECT id_pedido_detalle FROM pedido_detalle WHERE id_pedido = $1)`,
      [id_pedido]
    );
    await cx.ejecutar("DELETE FROM pedido_detalle WHERE id_pedido = $1", [id_pedido]);
    await cx.ejecutar("DELETE FROM pedidos WHERE id_pedido = $1", [id_pedido]);
  });
}

module.exports = { crear, buscarPorId, listar, marcarEntregado, cancelar };
