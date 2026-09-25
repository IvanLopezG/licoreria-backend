const productoService = require("../services/productoService");

async function crear(req, res) {
  try {
    const nuevo = await productoService.crearProducto(req.body);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "productos", id_entidad: nuevo.id_producto };

    return res.status(201).json(nuevo);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function editar(req, res) {
  try {
    const actualizado = await productoService.editarProducto(Number(req.params.id), req.body);

    req.auditoria = { accion: "editar", entidad: "productos", id_entidad: actualizado.id_producto };

    return res.json(actualizado);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function listar(req, res) {
  const soloAlerta = req.query.bajo_stock === "true";
  return res.json(await productoService.listarProductos({ soloAlerta }));
}

async function obtener(req, res) {
  try {
    return res.json(await productoService.obtenerProducto(Number(req.params.id)));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { crear, editar, listar, obtener };
