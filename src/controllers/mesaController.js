const mesaService = require("../services/mesaService");
const ventaService = require("../services/ventaService");

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
    const data = await mesaService.generarQR(Number(req.params.id));
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

function cerrarCuenta(req, res) {
  try {
    const venta = ventaService.cerrarCuentaMesa(Number(req.params.id), req.usuario.id_usuario, req.body);

    req.auditoria = { accion: "crear", entidad: "ventas", id_entidad: venta.id_venta };

    return res.status(201).json(venta);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { crear, listar, obtener, qr, cerrarCuenta };
