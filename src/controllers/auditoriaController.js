const logAuditoriaModel = require("../models/logAuditoriaModel");

function listar(req, res) {
  const { id_usuario, entidad } = req.query;
  return res.json(logAuditoriaModel.listar({ id_usuario, entidad }));
}

module.exports = { listar };
