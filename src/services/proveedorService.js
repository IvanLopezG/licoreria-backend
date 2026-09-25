const proveedorModel = require("../models/proveedorModel");
const productoModel = require("../models/productoModel");

function crearProveedor({ nombre, contacto }) {
  if (!nombre) {
    const err = new Error("nombre es obligatorio.");
    err.status = 400;
    throw err;
  }
  return proveedorModel.crear({ nombre, contacto });
}

function listarProveedores() {
  return proveedorModel.listar();
}

async function obtenerProveedor(id_proveedor) {
  const proveedor = await proveedorModel.buscarPorId(id_proveedor);
  if (!proveedor) {
    const err = new Error("Proveedor no encontrado.");
    err.status = 404;
    throw err;
  }
  return { ...proveedor, productos: await proveedorModel.listarProductos(id_proveedor) };
}

async function asociarProducto(id_proveedor, id_producto) {
  if (!(await proveedorModel.buscarPorId(id_proveedor))) {
    const err = new Error("Proveedor no encontrado.");
    err.status = 404;
    throw err;
  }
  if (!(await productoModel.buscarPorId(id_producto))) {
    const err = new Error("Producto no encontrado.");
    err.status = 404;
    throw err;
  }

  await proveedorModel.asociarProducto(id_proveedor, id_producto);
  return obtenerProveedor(id_proveedor);
}

module.exports = { crearProveedor, listarProveedores, obtenerProveedor, asociarProducto };
