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

// Tasas de impuesto en puntos básicos (1900 = 19 %), enteras entre 0 y 10000.
// Si un campo no llega se conserva el valor de "actuales" (en edición) o el
// valor por defecto (al crear), para no romper clientes que aún no los envían.
function validarImpuestos(body, actuales) {
  const resultado = {};
  for (const campo of ["tasa_iva_bps", "tasa_inc_bps"]) {
    const valor = body[campo] === undefined ? actuales[campo] : Number(body[campo]);
    if (!Number.isInteger(valor) || valor < 0 || valor > 10000) {
      const err = new Error(`${campo} debe ser un entero entre 0 y 10000 (1900 = 19 %).`);
      err.status = 400;
      throw err;
    }
    resultado[campo] = valor;
  }
  const alcoholica = body.es_bebida_alcoholica;
  resultado.es_bebida_alcoholica =
    alcoholica === undefined ? actuales.es_bebida_alcoholica : alcoholica === true || alcoholica === 1 || alcoholica === "true" ? 1 : 0;
  return resultado;
}

const IMPUESTOS_POR_DEFECTO = { tasa_iva_bps: 1900, tasa_inc_bps: 0, es_bebida_alcoholica: 0 };

function crearProducto(body) {
  const { nombre, id_categoria, unidad_medida, precio, stock_actual, umbral_alerta } = body;
  validarCamposBase({ nombre, id_categoria, unidad_medida, precio });
  const impuestos = validarImpuestos(body, IMPUESTOS_POR_DEFECTO);

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
    ...impuestos,
  });
  return agregarAlerta(producto);
}

// El stock solo cambia vía entradas/salidas (US-06/US-07), nunca por edición
// directa, para no perder la trazabilidad en movimientos_inventario.
function editarProducto(id_producto, body) {
  const { nombre, id_categoria, unidad_medida, precio, umbral_alerta } = body;
  const existente = productoModel.buscarPorId(id_producto);
  if (!existente) {
    const err = new Error("Producto no encontrado.");
    err.status = 404;
    throw err;
  }

  validarCamposBase({ nombre, id_categoria, unidad_medida, precio });
  const impuestos = validarImpuestos(body, existente);

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
    ...impuestos,
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
