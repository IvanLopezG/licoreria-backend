const mesaModel = require("../models/mesaModel");
const ventaModel = require("../models/ventaModel");
const productoModel = require("../models/productoModel");
const facturaService = require("./facturaService");
const { ErrorNoEncontrado, ErrorValidacion } = require("../utils/errores");

// La mesa solo pasa a "ocupada" al recibir un pedido (US-12) y solo vuelve
// a "libre" al cerrar cuenta (US-14); si no está ocupada no hay nada que cobrar.
async function cerrarCuentaMesa(id_mesa, id_usuario, body) {
  const mesa = await mesaModel.buscarPorId(id_mesa);
  if (!mesa) {
    throw new ErrorNoEncontrado("Mesa no encontrada.");
  }
  if (mesa.estado !== "ocupada") {
    throw new ErrorValidacion("La mesa no está ocupada; no hay cuenta que cerrar.");
  }

  const datosFactura = facturaService.validarDatosFactura(body, "mesa");
  return ventaModel.cerrarCuentaMesa(id_mesa, id_usuario, datosFactura);
}

// La existencia del producto se valida aquí; si hay stock suficiente o no se
// decide dentro de la transacción (ventaModel → descontarPorVenta), que es el
// único punto donde eso puede verificarse de forma atómica.
async function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ErrorValidacion("La venta debe tener al menos un producto.");
  }

  const lineas = [];
  for (const { id_producto, cantidad } of items) {
    if (!id_producto || cantidad === undefined || cantidad === null || Number(cantidad) <= 0) {
      throw new ErrorValidacion("Cada línea requiere id_producto y cantidad mayor a 0.");
    }
    const producto = await productoModel.buscarPorId(id_producto);
    if (!producto) {
      throw new ErrorNoEncontrado(`Producto ${id_producto} no encontrado.`);
    }
    if (producto.activo !== 1) {
      throw new ErrorValidacion(`${producto.nombre} está inactivo y no se puede vender.`);
    }
    lineas.push({ id_producto, cantidad: Number(cantidad), precio_unitario: producto.precio });
  }
  return lineas;
}

async function crearVentaMostrador(body, id_usuario) {
  const lineas = await validarItems(body?.items);
  const datosFactura = facturaService.validarDatosFactura(body, "mostrador");
  return ventaModel.crearVentaMostrador({ items: lineas, id_usuario, datosFactura });
}

function listarVentas({ desde, hasta, tipo, incluir_anuladas }) {
  return ventaModel.listar({ desde, hasta, tipo, incluir_anuladas });
}

module.exports = { cerrarCuentaMesa, crearVentaMostrador, listarVentas };
