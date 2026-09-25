const pedidoService = require("../services/pedidoService");

async function listar(req, res) {
  const { estado, id_mesa } = req.query;
  return res.json(await pedidoService.listarPedidos({ estado, id_mesa }));
}

async function entregado(req, res) {
  try {
    const pedido = await pedidoService.marcarEntregado(Number(req.params.id));

    req.auditoria = { accion: "editar", entidad: "pedidos", id_entidad: pedido.id_pedido };

    return res.json(pedido);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function cancelar(req, res) {
  try {
    const id_pedido = Number(req.params.id);
    const resultado = await pedidoService.cancelar(id_pedido);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "eliminar", entidad: "pedidos", id_entidad: id_pedido };

    return res.json(resultado);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { listar, entregado, cancelar };
