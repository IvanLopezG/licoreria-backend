const pedidoService = require("../services/pedidoService");

function listar(req, res) {
  const { estado, id_mesa } = req.query;
  return res.json(pedidoService.listarPedidos({ estado, id_mesa }));
}

function entregado(req, res) {
  try {
    const pedido = pedidoService.marcarEntregado(Number(req.params.id));

    req.auditoria = { accion: "editar", entidad: "pedidos", id_entidad: pedido.id_pedido };

    return res.json(pedido);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { listar, entregado };
