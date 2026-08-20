const movimientoModel = require("../models/movimientoInventarioModel");
const productoModel = require("../models/productoModel");
const proveedorModel = require("../models/proveedorModel");

function validarProductoYCantidad(id_producto, cantidad) {
  if (!id_producto || cantidad === undefined || cantidad === null || Number(cantidad) <= 0) {
    const err = new Error("id_producto y cantidad (mayor a 0) son obligatorios.");
    err.status = 400;
    throw err;
  }

  const producto = productoModel.buscarPorId(id_producto);
  if (!producto) {
    const err = new Error("Producto no encontrado.");
    err.status = 404;
    throw err;
  }
  return producto;
}

function registrarEntrada({ id_producto, cantidad, id_proveedor }, id_usuario) {
  validarProductoYCantidad(id_producto, cantidad);

  if (!id_proveedor) {
    const err = new Error("id_proveedor es obligatorio en una entrada.");
    err.status = 400;
    throw err;
  }
  if (!proveedorModel.buscarPorId(id_proveedor)) {
    const err = new Error("Proveedor no encontrado.");
    err.status = 404;
    throw err;
  }

  return movimientoModel.registrarEntrada({
    id_producto,
    cantidad: Number(cantidad),
    id_proveedor,
    id_usuario,
  });
}

module.exports = { registrarEntrada };
