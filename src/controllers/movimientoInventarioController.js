const movimientoService = require("../services/movimientoInventarioService");

function entrada(req, res) {
  try {
    const movimiento = movimientoService.registrarEntrada(req.body, req.usuario.id_usuario);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "movimientos_inventario", id_entidad: movimiento.id_movimiento };

    return res.status(201).json(movimiento);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { entrada };
