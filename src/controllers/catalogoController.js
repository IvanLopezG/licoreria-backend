const catalogoService = require("../services/catalogoService");

async function obtener(req, res) {
  try {
    return res.json(await catalogoService.obtenerCatalogo(req.params.token));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function crearPedido(req, res) {
  try {
    const pedido = await catalogoService.crearPedido(req.params.token, req.body.items);
    return res.status(201).json(pedido);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function listarPedidos(req, res) {
  try {
    return res.json(await catalogoService.listarPedidos(req.params.token));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { obtener, crearPedido, listarPedidos };
