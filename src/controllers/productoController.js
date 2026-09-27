const productoService = require("../services/productoService");

async function crear(req, res) {
  const nuevo = await productoService.crearProducto(req.body, req.usuario.rol);

  // El middleware de auditoría escribe el registro al ver este campo.
  req.auditoria = { accion: "crear", entidad: "productos", id_entidad: nuevo.id_producto };

  return res.status(201).json(nuevo);
}

async function editar(req, res) {
  const actualizado = await productoService.editarProducto(Number(req.params.id), req.body, req.usuario.rol);

  req.auditoria = { accion: "editar", entidad: "productos", id_entidad: actualizado.id_producto };

  return res.json(actualizado);
}

async function listar(req, res) {
  const soloAlerta = req.query.bajo_stock === "true";
  return res.json(await productoService.listarProductos({ soloAlerta }));
}

async function obtener(req, res) {
  return res.json(await productoService.obtenerProducto(Number(req.params.id)));
}

module.exports = { crear, editar, listar, obtener };
