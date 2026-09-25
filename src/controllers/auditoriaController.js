const logAuditoriaModel = require("../models/logAuditoriaModel");

async function listar(req, res) {
  const { id_usuario, entidad } = req.query;
  return res.json(await logAuditoriaModel.listar({ id_usuario, entidad }));
}

module.exports = { listar };
