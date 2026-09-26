const productoModel = require("../models/productoModel");

// RF-08: el umbral es configurable por producto (columna umbral_alerta);
// esta función solo calcula la bandera para que el listado la resalte (US-08).
function agregarAlerta(producto) {
  return { ...producto, alerta_stock_bajo: producto.stock_actual <= producto.umbral_alerta };
}

async function validarCamposBase({ nombre, id_categoria, unidad_medida, precio }) {
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

  if (!(await productoModel.existeCategoria(id_categoria))) {
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

const EXTRAS_POR_DEFECTO = {
  costo: null, codigo_barras: null, marca: null, volumen_ml: null, grado_alcohol: null, descripcion: null, activo: 1,
};
const MAX_DESCRIPCION = 300;

function errorValidacion(mensaje, status = 400) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

// Campo opcional: si no llega se conserva el valor de "actuales"; "" o null lo borran.
const vacio = (valor) => valor === null || (typeof valor === "string" && valor.trim() === "");

function numeroOpcional(body, actuales, campo, { entero = false, min, max, mensaje }) {
  if (body[campo] === undefined) return actuales[campo];
  if (vacio(body[campo])) return null;
  const n = Number(body[campo]);
  if (!Number.isFinite(n) || (entero && !Number.isInteger(n)) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
    throw errorValidacion(mensaje);
  }
  return n;
}

function textoOpcional(body, actuales, campo) {
  if (body[campo] === undefined) return actuales[campo];
  return vacio(body[campo]) ? null : String(body[campo]).trim();
}

// Datos comerciales opcionales (costo, código, marca, volumen, grado,
// descripción, activo). Nunca son obligatorios: la app Android no los envía.
// es_bebida_alcoholica ya validada: sin ella, el grado alcohólico se borra.
async function validarExtras(body, actuales, { id_producto = null, es_bebida_alcoholica }) {
  const extras = {
    costo: numeroOpcional(body, actuales, "costo", { min: 0, mensaje: "costo debe ser un número mayor o igual a 0." }),
    codigo_barras: textoOpcional(body, actuales, "codigo_barras"),
    marca: textoOpcional(body, actuales, "marca"),
    volumen_ml: numeroOpcional(body, actuales, "volumen_ml", {
      entero: true, min: 1, mensaje: "volumen_ml debe ser un entero mayor a 0 (mililitros).",
    }),
    grado_alcohol: numeroOpcional(body, actuales, "grado_alcohol", {
      min: 0, max: 100, mensaje: "grado_alcohol debe ser un porcentaje entre 0 y 100.",
    }),
    descripcion: textoOpcional(body, actuales, "descripcion"),
  };

  if (extras.descripcion && extras.descripcion.length > MAX_DESCRIPCION) {
    throw errorValidacion(`descripcion admite máximo ${MAX_DESCRIPCION} caracteres.`);
  }
  if (!es_bebida_alcoholica) extras.grado_alcohol = null;

  const activo = body.activo;
  if (activo === undefined) extras.activo = actuales.activo;
  else if (activo === true || activo === 1 || activo === "true" || activo === "1") extras.activo = 1;
  else if (activo === false || activo === 0 || activo === "false" || activo === "0") extras.activo = 0;
  else throw errorValidacion("activo debe ser true/false o 1/0.");

  if (extras.codigo_barras && (await productoModel.codigoEnUso(extras.codigo_barras, id_producto))) {
    throw errorValidacion(`El código de barras / SKU "${extras.codigo_barras}" ya está asignado a otro producto.`, 409);
  }
  return extras;
}

async function crearProducto(body) {
  const { nombre, id_categoria, unidad_medida, precio, stock_actual, umbral_alerta } = body;
  await validarCamposBase({ nombre, id_categoria, unidad_medida, precio });
  const impuestos = validarImpuestos(body, IMPUESTOS_POR_DEFECTO);
  const extras = await validarExtras(body, EXTRAS_POR_DEFECTO, { es_bebida_alcoholica: impuestos.es_bebida_alcoholica });

  const stockInicial = stock_actual === undefined ? 0 : Number(stock_actual);
  const umbral = umbral_alerta === undefined ? 0 : Number(umbral_alerta);

  if (stockInicial < 0 || umbral < 0) {
    const err = new Error("stock_actual y umbral_alerta no pueden ser negativos.");
    err.status = 400;
    throw err;
  }

  const producto = await productoModel.crear({
    id_categoria,
    nombre,
    unidad_medida,
    precio: Number(precio),
    stock_actual: stockInicial,
    umbral_alerta: umbral,
    ...impuestos,
    ...extras,
  });
  return agregarAlerta(producto);
}

// El stock solo cambia vía entradas/salidas (US-06/US-07), nunca por edición
// directa, para no perder la trazabilidad en movimientos_inventario.
async function editarProducto(id_producto, body) {
  const { nombre, id_categoria, unidad_medida, precio, umbral_alerta } = body;
  const existente = await productoModel.buscarPorId(id_producto);
  if (!existente) {
    const err = new Error("Producto no encontrado.");
    err.status = 404;
    throw err;
  }

  await validarCamposBase({ nombre, id_categoria, unidad_medida, precio });
  const impuestos = validarImpuestos(body, existente);
  const extras = await validarExtras(body, existente, { id_producto, es_bebida_alcoholica: impuestos.es_bebida_alcoholica });

  const umbral = umbral_alerta === undefined ? existente.umbral_alerta : Number(umbral_alerta);
  if (umbral < 0) {
    const err = new Error("umbral_alerta no puede ser negativo.");
    err.status = 400;
    throw err;
  }

  const producto = await productoModel.editar(id_producto, {
    id_categoria,
    nombre,
    unidad_medida,
    precio: Number(precio),
    umbral_alerta: umbral,
    ...impuestos,
    ...extras,
  });
  return agregarAlerta(producto);
}

async function listarProductos({ soloAlerta } = {}) {
  const productos = (await productoModel.listar()).map(agregarAlerta);
  return soloAlerta ? productos.filter((p) => p.alerta_stock_bajo) : productos;
}

async function obtenerProducto(id_producto) {
  const producto = await productoModel.buscarPorId(id_producto);
  if (!producto) {
    const err = new Error("Producto no encontrado.");
    err.status = 404;
    throw err;
  }
  return agregarAlerta(producto);
}

module.exports = { crearProducto, editarProducto, listarProductos, obtenerProducto };
