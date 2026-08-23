const ventaService = require("../services/ventaService");

function crearMostrador(req, res) {
  try {
    const venta = ventaService.crearVentaMostrador(req.body, req.usuario.id_usuario);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "ventas", id_entidad: venta.id_venta };

    return res.status(201).json(venta);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

function listar(req, res) {
  const { desde, hasta, tipo } = req.query;
  return res.json(ventaService.listarVentas({ desde, hasta, tipo }));
}

module.exports = { crearMostrador, listar };
