const proveedorService = require("../services/proveedorService");

function crear(req, res) {
  try {
    const nuevo = proveedorService.crearProveedor(req.body);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "proveedores", id_entidad: nuevo.id_proveedor };

    return res.status(201).json(nuevo);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

function listar(req, res) {
  return res.json(proveedorService.listarProveedores());
}

function obtener(req, res) {
  try {
    return res.json(proveedorService.obtenerProveedor(Number(req.params.id)));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

function asociarProducto(req, res) {
  try {
    const actualizado = proveedorService.asociarProducto(Number(req.params.id), Number(req.body.id_producto));

    req.auditoria = { accion: "editar", entidad: "proveedores", id_entidad: actualizado.id_proveedor };

    return res.status(201).json(actualizado);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { crear, listar, obtener, asociarProducto };
