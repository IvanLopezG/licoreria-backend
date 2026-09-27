const movimientoModel = require("../models/movimientoInventarioModel");
const productoModel = require("../models/productoModel");
const proveedorModel = require("../models/proveedorModel");
const { ErrorNoEncontrado, ErrorValidacion } = require("../utils/errores");

const MOTIVOS_SALIDA_VALIDOS = ["venta", "ajuste"];

async function validarProductoYCantidad(id_producto, cantidad) {
  if (!id_producto || cantidad === undefined || cantidad === null || Number(cantidad) <= 0) {
    throw new ErrorValidacion("id_producto y cantidad (mayor a 0) son obligatorios.");
  }

  const producto = await productoModel.buscarPorId(id_producto);
  if (!producto) {
    throw new ErrorNoEncontrado("Producto no encontrado.");
  }
  return producto;
}

async function registrarEntrada({ id_producto, cantidad, id_proveedor }, id_usuario) {
  await validarProductoYCantidad(id_producto, cantidad);

  if (!id_proveedor) {
    throw new ErrorValidacion("id_proveedor es obligatorio en una entrada.");
  }
  if (!(await proveedorModel.buscarPorId(id_proveedor))) {
    throw new ErrorNoEncontrado("Proveedor no encontrado.");
  }

  return movimientoModel.registrarEntrada({
    id_producto,
    cantidad: Number(cantidad),
    id_proveedor,
    id_usuario,
  });
}

async function registrarSalida({ id_producto, cantidad, motivo }, id_usuario) {
  const producto = await validarProductoYCantidad(id_producto, cantidad);

  if (!MOTIVOS_SALIDA_VALIDOS.includes(motivo)) {
    throw new ErrorValidacion(`motivo inválido. Debe ser uno de: ${MOTIVOS_SALIDA_VALIDOS.join(", ")}.`);
  }
  if (producto.stock_actual < Number(cantidad)) {
    throw new ErrorValidacion("No hay stock suficiente para esta salida.");
  }

  return movimientoModel.registrarSalida({
    id_producto,
    cantidad: Number(cantidad),
    motivo,
    id_usuario,
  });
}

function historial({ id_producto, desde, hasta, id_usuario }) {
  return movimientoModel.listar({ id_producto, desde, hasta, id_usuario });
}

module.exports = { registrarEntrada, registrarSalida, historial };
