const productoService = require("../services/productoService");

function crear(req, res) {
  try {
    const nuevo = productoService.crearProducto(req.body);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "productos", id_entidad: nuevo.id_producto };

    return res.status(201).json(nuevo);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

function editar(req, res) {
  try {
    const actualizado = productoService.editarProducto(Number(req.params.id), req.body);

    req.auditoria = { accion: "editar", entidad: "productos", id_entidad: actualizado.id_producto };

    return res.json(actualizado);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

function listar(req, res) {
  const soloAlerta = req.query.bajo_stock === "true";
  return res.json(productoService.listarProductos({ soloAlerta }));
}

function obtener(req, res) {
  try {
    return res.json(productoService.obtenerProducto(Number(req.params.id)));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { crear, editar, listar, obtener };
