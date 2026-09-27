const proveedorService = require("../services/proveedorService");

async function crear(req, res) {
  const nuevo = await proveedorService.crearProveedor(req.body);

  // El middleware de auditoría escribe el registro al ver este campo.
  req.auditoria = { accion: "crear", entidad: "proveedores", id_entidad: nuevo.id_proveedor };

  return res.status(201).json(nuevo);
}

async function listar(req, res) {
  return res.json(await proveedorService.listarProveedores());
}

async function obtener(req, res) {
  return res.json(await proveedorService.obtenerProveedor(Number(req.params.id)));
}

async function asociarProducto(req, res) {
  const actualizado = await proveedorService.asociarProducto(Number(req.params.id), Number(req.body.id_producto));

  req.auditoria = { accion: "editar", entidad: "proveedores", id_entidad: actualizado.id_proveedor };

  return res.status(201).json(actualizado);
}

async function editar(req, res) {
  const actualizado = await proveedorService.editarProveedor(Number(req.params.id), req.body);

  req.auditoria = { accion: "editar", entidad: "proveedores", id_entidad: actualizado.id_proveedor };

  return res.json(actualizado);
}

async function quitarProducto(req, res) {
  const actualizado = await proveedorService.quitarProducto(Number(req.params.id), Number(req.params.id_producto));

  req.auditoria = { accion: "editar", entidad: "proveedores", id_entidad: actualizado.id_proveedor };

  return res.json(actualizado);
}

module.exports = { crear, listar, obtener, editar, asociarProducto, quitarProducto };
