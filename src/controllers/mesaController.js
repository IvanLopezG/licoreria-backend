const mesaService = require("../services/mesaService");
const ventaService = require("../services/ventaService");

async function crear(req, res) {
  const mesa = await mesaService.crearMesa(req.body);

  // El middleware de auditoría escribe el registro al ver este campo.
  req.auditoria = { accion: "crear", entidad: "mesas", id_entidad: mesa.id_mesa };

  return res.status(201).json(mesa);
}

async function listar(req, res) {
  return res.json(await mesaService.listarMesas());
}

async function obtener(req, res) {
  return res.json(await mesaService.obtenerMesa(Number(req.params.id)));
}

async function qr(req, res) {
  const data = await mesaService.generarQR(Number(req.params.id));
  return res.json(data);
}

async function cerrarCuenta(req, res) {
  const venta = await ventaService.cerrarCuentaMesa(Number(req.params.id), req.usuario.id_usuario, req.body);

  req.auditoria = { accion: "crear", entidad: "ventas", id_entidad: venta.id_venta };

  return res.status(201).json(venta);
}

module.exports = { crear, listar, obtener, qr, cerrarCuenta };
