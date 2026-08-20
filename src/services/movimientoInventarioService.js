const movimientoModel = require("../models/movimientoInventarioModel");
const productoModel = require("../models/productoModel");
const proveedorModel = require("../models/proveedorModel");

const MOTIVOS_SALIDA_VALIDOS = ["venta", "ajuste"];

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

function registrarSalida({ id_producto, cantidad, motivo }, id_usuario) {
  const producto = validarProductoYCantidad(id_producto, cantidad);

  if (!MOTIVOS_SALIDA_VALIDOS.includes(motivo)) {
    const err = new Error(`motivo inválido. Debe ser uno de: ${MOTIVOS_SALIDA_VALIDOS.join(", ")}.`);
    err.status = 400;
    throw err;
  }
  if (producto.stock_actual < Number(cantidad)) {
    const err = new Error("No hay stock suficiente para esta salida.");
    err.status = 400;
    throw err;
  }

  return movimientoModel.registrarSalida({
    id_producto,
    cantidad: Number(cantidad),
    motivo,
    id_usuario,
  });
}

function historial({ id_producto, desde, hasta }) {
  return movimientoModel.listar({ id_producto, desde, hasta });
}

module.exports = { registrarEntrada, registrarSalida, historial };
