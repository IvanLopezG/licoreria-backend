const mesaService = require("../services/mesaService");

function crear(req, res) {
  try {
    const mesa = mesaService.crearMesa(req.body);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "mesas", id_entidad: mesa.id_mesa };

    return res.status(201).json(mesa);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

function listar(req, res) {
  return res.json(mesaService.listarMesas());
}

function obtener(req, res) {
  try {
    return res.json(mesaService.obtenerMesa(Number(req.params.id)));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function qr(req, res) {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const data = await mesaService.generarQR(Number(req.params.id), baseUrl);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { crear, listar, obtener, qr };
