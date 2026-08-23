const catalogoService = require("../services/catalogoService");

function obtener(req, res) {
  try {
    return res.json(catalogoService.obtenerCatalogo(req.params.token));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

function crearPedido(req, res) {
  try {
    const pedido = catalogoService.crearPedido(req.params.token, req.body.items);
    return res.status(201).json(pedido);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { obtener, crearPedido };
