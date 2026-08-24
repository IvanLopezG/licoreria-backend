const mesaModel = require("../models/mesaModel");
const productoModel = require("../models/productoModel");
const pedidoModel = require("../models/pedidoModel");

function buscarMesaPorToken(token) {
  const mesa = mesaModel.buscarPorToken(token);
  if (!mesa) {
    const err = new Error("Mesa no encontrada.");
    err.status = 404;
    throw err;
  }
  return mesa;
}

// RF-11: el catálogo público solo muestra disponibilidad (stock_actual > 0),
// nunca el stock exacto ni columnas internas del producto.
function obtenerCatalogo(token) {
  const mesa = buscarMesaPorToken(token);
  const productos = productoModel
    .listar()
    .filter((p) => p.stock_actual > 0)
    .map(({ id_producto, nombre, categoria_nombre, unidad_medida, precio }) => ({
      id_producto,
      nombre,
      categoria_nombre,
      unidad_medida,
      precio,
    }));

  return { mesa: { numero: mesa.numero }, productos };
}

// RF-12: valida cada línea contra el producto real y copia precio_unitario
// al momento del pedido (regla de negocio ya decidida, no se normaliza).
function crearPedido(token, items) {
  const mesa = buscarMesaPorToken(token);

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("El pedido debe tener al menos un producto.");
    err.status = 400;
    throw err;
  }

  const lineas = items.map(({ id_producto, cantidad }) => {
    if (!id_producto || cantidad === undefined || cantidad === null || Number(cantidad) <= 0) {
      const err = new Error("Cada línea del pedido requiere id_producto y cantidad mayor a 0.");
      err.status = 400;
      throw err;
    }

    const producto = productoModel.buscarPorId(id_producto);
    if (!producto) {
      const err = new Error(`Producto ${id_producto} no encontrado.`);
      err.status = 404;
      throw err;
    }
    if (producto.stock_actual <= 0) {
      const err = new Error(`${producto.nombre} ya no está disponible.`);
      err.status = 400;
      throw err;
    }

    return { id_producto, cantidad: Number(cantidad), precio_unitario: producto.precio };
  });

  return pedidoModel.crear({ id_mesa: mesa.id_mesa, items: lineas });
}

// Permite que el cliente vea su historial de pedidos en esa mesa (aunque
// recargue la página o vuelva a abrir el link más tarde), sin exponer
// pedidos de otras mesas. Solo los abiertos (id_venta nulo): una vez cerrada
// la cuenta, la mesa vuelve a quedar libre para un cliente nuevo, que no
// debe ver pedidos ya cobrados de quien estuvo antes en esa misma mesa.
function listarPedidos(token) {
  const mesa = buscarMesaPorToken(token);
  return pedidoModel.listar({ id_mesa: mesa.id_mesa }).filter((p) => p.id_venta === null);
}

module.exports = { obtenerCatalogo, crearPedido, listarPedidos, buscarMesaPorToken };
