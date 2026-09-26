const proveedorModel = require("../models/proveedorModel");
const productoModel = require("../models/productoModel");
const { normalizarNit, esNitValido, calcularDv } = require("../utils/nit");

const CONDICIONES_PAGO = ["contado", "credito"];
const TEXTOS = ["contacto", "telefono", "correo", "direccion", "ciudad", "notas"];

const POR_DEFECTO = {
  contacto: null, nit: null, dv: null, telefono: null, correo: null, direccion: null, ciudad: null,
  condicion_pago: null, dias_credito: null, notas: null, activo: 1,
};

function errorConEstado(mensaje, status = 400) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

const esCorreoValido = (correo) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);

// "" o null borran el campo; si no llega, se conserva el valor de "actuales".
function texto(body, actuales, campo) {
  if (body[campo] === undefined) return actuales[campo];
  if (body[campo] === null) return null;
  const limpio = String(body[campo]).trim();
  return limpio === "" ? null : limpio;
}

// Valida y completa los datos del proveedor. Todo es opcional salvo el
// nombre, para que la app Android (que solo envía nombre y contacto) siga
// funcionando sin cambios.
function validarDatos(body, actuales) {
  const datos = { nombre: texto(body, actuales, "nombre") };
  if (!datos.nombre) throw errorConEstado("nombre es obligatorio.");
  for (const campo of TEXTOS) datos[campo] = texto(body, actuales, campo);

  if (datos.correo && !esCorreoValido(datos.correo)) {
    throw errorConEstado("correo no es un correo electrónico válido.");
  }

  // NIT: el DV siempre lo calcula el servidor (mismo algoritmo DIAN del emisor).
  const nit = texto(body, actuales, "nit");
  if (nit === null) {
    datos.nit = null;
    datos.dv = null;
  } else {
    datos.nit = normalizarNit(nit);
    if (!esNitValido(datos.nit)) throw errorConEstado("El NIT debe tener entre 5 y 15 dígitos (sin el DV).");
    datos.dv = calcularDv(datos.nit);
    const dvRecibido = body.dv === undefined || body.dv === null ? "" : String(body.dv).trim();
    if (dvRecibido !== "" && dvRecibido !== datos.dv) {
      throw errorConEstado(`El DV no corresponde a este NIT (el correcto es ${datos.dv}).`);
    }
  }

  datos.condicion_pago = texto(body, actuales, "condicion_pago");
  if (datos.condicion_pago !== null && !CONDICIONES_PAGO.includes(datos.condicion_pago)) {
    throw errorConEstado(`condicion_pago debe ser: ${CONDICIONES_PAGO.join(" o ")}.`);
  }
  // Días de crédito solo aplican a crédito; en contado (o sin condición) se borran.
  if (datos.condicion_pago === "credito") {
    const dias = body.dias_credito === undefined ? actuales.dias_credito : body.dias_credito;
    if (dias === null || dias === "") {
      datos.dias_credito = null;
    } else {
      const n = Number(dias);
      if (!Number.isInteger(n) || n < 1) throw errorConEstado("dias_credito debe ser un entero mayor a 0.");
      datos.dias_credito = n;
    }
  } else {
    datos.dias_credito = null;
  }

  const activo = body.activo;
  if (activo === undefined) datos.activo = actuales.activo;
  else if (activo === true || activo === 1 || activo === "true" || activo === "1") datos.activo = 1;
  else if (activo === false || activo === 0 || activo === "false" || activo === "0") datos.activo = 0;
  else throw errorConEstado("activo debe ser true/false o 1/0.");

  return datos;
}

function crearProveedor(body = {}) {
  return proveedorModel.crear(validarDatos(body, POR_DEFECTO));
}

// Edición parcial: los campos que no llegan conservan su valor actual.
async function editarProveedor(id_proveedor, body = {}) {
  const actual = await proveedorModel.buscarPorId(id_proveedor);
  if (!actual) throw errorConEstado("Proveedor no encontrado.", 404);
  await proveedorModel.editar(id_proveedor, validarDatos(body, actual));
  return obtenerProveedor(id_proveedor);
}

function listarProveedores() {
  return proveedorModel.listar();
}

async function obtenerProveedor(id_proveedor) {
  const proveedor = await proveedorModel.buscarPorId(id_proveedor);
  if (!proveedor) throw errorConEstado("Proveedor no encontrado.", 404);
  return { ...proveedor, productos: await proveedorModel.listarProductos(id_proveedor) };
}

async function asociarProducto(id_proveedor, id_producto) {
  if (!(await proveedorModel.buscarPorId(id_proveedor))) throw errorConEstado("Proveedor no encontrado.", 404);
  if (!(await productoModel.buscarPorId(id_producto))) throw errorConEstado("Producto no encontrado.", 404);

  await proveedorModel.asociarProducto(id_proveedor, id_producto);
  return obtenerProveedor(id_proveedor);
}

async function quitarProducto(id_proveedor, id_producto) {
  if (!(await proveedorModel.buscarPorId(id_proveedor))) throw errorConEstado("Proveedor no encontrado.", 404);
  if ((await proveedorModel.quitarProducto(id_proveedor, id_producto)) === 0) {
    throw errorConEstado("Ese producto no está asociado a este proveedor.", 404);
  }
  return obtenerProveedor(id_proveedor);
}

module.exports = { crearProveedor, editarProveedor, listarProveedores, obtenerProveedor, asociarProducto, quitarProducto };
