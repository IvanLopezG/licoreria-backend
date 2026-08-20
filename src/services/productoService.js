const productoModel = require("../models/productoModel");

// RF-08: el umbral es configurable por producto (columna umbral_alerta);
// esta función solo calcula la bandera para que el listado la resalte (US-08).
function agregarAlerta(producto) {
  return { ...producto, alerta_stock_bajo: producto.stock_actual <= producto.umbral_alerta };
}

function validarCamposBase({ nombre, id_categoria, unidad_medida, precio }) {
  if (!nombre || !id_categoria || !unidad_medida || precio === undefined || precio === null || precio === "") {
    const err = new Error("nombre, id_categoria, unidad_medida y precio son obligatorios.");
    err.status = 400;
    throw err;
  }

  if (Number(precio) <= 0) {
    const err = new Error("precio debe ser mayor a 0.");
    err.status = 400;
    throw err;
  }

  if (!productoModel.existeCategoria(id_categoria)) {
    const err = new Error("id_categoria no existe.");
    err.status = 400;
    throw err;
  }
}

function crearProducto({ nombre, id_categoria, unidad_medida, precio, stock_actual, umbral_alerta }) {
  validarCamposBase({ nombre, id_categoria, unidad_medida, precio });

  const stockInicial = stock_actual === undefined ? 0 : Number(stock_actual);
  const umbral = umbral_alerta === undefined ? 0 : Number(umbral_alerta);

  if (stockInicial < 0 || umbral < 0) {
    const err = new Error("stock_actual y umbral_alerta no pueden ser negativos.");
    err.status = 400;
    throw err;
  }

  const producto = productoModel.crear({
    id_categoria,
    nombre,
    unidad_medida,
    precio: Number(precio),
    stock_actual: stockInicial,
    umbral_alerta: umbral,
  });
  return agregarAlerta(producto);
}

// El stock solo cambia vía entradas/salidas (US-06/US-07), nunca por edición
// directa, para no perder la trazabilidad en movimientos_inventario.
function editarProducto(id_producto, { nombre, id_categoria, unidad_medida, precio, umbral_alerta }) {
  const existente = productoModel.buscarPorId(id_producto);
  if (!existente) {
    const err = new Error("Producto no encontrado.");
    err.status = 404;
    throw err;
  }

  validarCamposBase({ nombre, id_categoria, unidad_medida, precio });

  const umbral = umbral_alerta === undefined ? existente.umbral_alerta : Number(umbral_alerta);
  if (umbral < 0) {
    const err = new Error("umbral_alerta no puede ser negativo.");
    err.status = 400;
    throw err;
  }

  const producto = productoModel.editar(id_producto, {
    id_categoria,
    nombre,
    unidad_medida,
    precio: Number(precio),
    umbral_alerta: umbral,
  });
  return agregarAlerta(producto);
}

function listarProductos({ soloAlerta } = {}) {
  const productos = productoModel.listar().map(agregarAlerta);
  return soloAlerta ? productos.filter((p) => p.alerta_stock_bajo) : productos;
}

function obtenerProducto(id_producto) {
  const producto = productoModel.buscarPorId(id_producto);
  if (!producto) {
    const err = new Error("Producto no encontrado.");
    err.status = 404;
    throw err;
  }
  return agregarAlerta(producto);
}

module.exports = { crearProducto, editarProducto, listarProductos, obtenerProducto };
