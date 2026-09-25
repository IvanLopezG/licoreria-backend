const pedidoModel = require("../models/pedidoModel");

// RF-13: el panel agrupa por mesa del lado del cliente; aquí solo se filtra.
function listarPedidos({ estado, id_mesa }) {
  return pedidoModel.listar({ estado, id_mesa });
}

async function marcarEntregado(id_pedido) {
  const pedido = await pedidoModel.buscarPorId(id_pedido);
  if (!pedido) {
    const err = new Error("Pedido no encontrado.");
    err.status = 404;
    throw err;
  }
  return pedidoModel.marcarEntregado(id_pedido);
}

// Permite destrabar una mesa cuando un pedido quedó con datos inválidos
// (p. ej. una cantidad mayor al stock disponible que se coló antes de que
// existiera esa validación) y por eso el cierre de cuenta, al ser
// todo-o-nada, no puede completarse mientras ese pedido exista. Solo se
// puede cancelar mientras siga sin cobrar (id_venta nulo); una vez
// facturado, forma parte de una venta ya cerrada y no se toca.
async function cancelar(id_pedido) {
  const pedido = await pedidoModel.buscarPorId(id_pedido);
  if (!pedido) {
    const err = new Error("Pedido no encontrado.");
    err.status = 404;
    throw err;
  }
  if (pedido.id_venta !== null && pedido.id_venta !== undefined) {
    const err = new Error("No se puede cancelar un pedido que ya fue cobrado.");
    err.status = 400;
    throw err;
  }

  await pedidoModel.cancelar(id_pedido);
  return { id_pedido };
}

module.exports = { listarPedidos, marcarEntregado, cancelar };
