const pedidoModel = require("../models/pedidoModel");

// RF-13: el panel agrupa por mesa del lado del cliente; aquí solo se filtra.
function listarPedidos({ estado, id_mesa }) {
  return pedidoModel.listar({ estado, id_mesa });
}

function marcarEntregado(id_pedido) {
  const pedido = pedidoModel.buscarPorId(id_pedido);
  if (!pedido) {
    const err = new Error("Pedido no encontrado.");
    err.status = 404;
    throw err;
  }
  return pedidoModel.marcarEntregado(id_pedido);
}

module.exports = { listarPedidos, marcarEntregado };
