const catalogoService = require("../services/catalogoService");

function obtener(req, res) {
  try {
    return res.json(catalogoService.obtenerCatalogo(req.params.token));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { obtener };
