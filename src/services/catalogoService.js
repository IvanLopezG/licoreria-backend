const mesaModel = require("../models/mesaModel");
const productoModel = require("../models/productoModel");
const pedidoModel = require("../models/pedidoModel");
const mesaSesionModel = require("../models/mesaSesionModel");

async function buscarMesaPorToken(token) {
  const mesa = await mesaModel.buscarPorToken(token);
  if (!mesa) {
    const err = new Error("Mesa no encontrada.");
    err.status = 404;
    throw err;
  }
  return mesa;
}

// RF-11: el catálogo público solo muestra disponibilidad (stock_actual > 0),
// nunca el stock exacto ni columnas internas del producto. Los productos
// inactivos no se ofrecen.
async function obtenerCatalogo(token) {
  const mesa = await buscarMesaPorToken(token);
  const productos = (await productoModel.listar())
    .filter((p) => p.activo === 1 && p.stock_actual > 0)
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
// token_sesion: el que ya tiene el celular (encabezado X-Sesion-Token); si no
// sirve para la sesión activa de la mesa, la respuesta trae uno nuevo.
async function crearPedido(token, items, token_sesion) {
  const mesa = await buscarMesaPorToken(token);

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("El pedido debe tener al menos un producto.");
    err.status = 400;
    throw err;
  }

  const lineas = [];
  for (const { id_producto, cantidad } of items) {
    const cantidadNum = Number(cantidad);
    if (!id_producto || cantidad === undefined || cantidad === null || !Number.isInteger(cantidadNum) || cantidadNum < 1) {
      const err = new Error("Cada línea del pedido requiere id_producto y una cantidad entera mayor o igual a 1.");
      err.status = 400;
      throw err;
    }

    const producto = await productoModel.buscarPorId(id_producto);
    if (!producto) {
      const err = new Error(`Producto ${id_producto} no encontrado.`);
      err.status = 404;
      throw err;
    }
    if (producto.activo !== 1) {
      const err = new Error(`${producto.nombre} ya no está disponible.`);
      err.status = 400;
      throw err;
    }
    if (cantidadNum > producto.stock_actual) {
      const err = new Error(`Solo quedan ${producto.stock_actual} unidades de ${producto.nombre}.`);
      err.status = 400;
      throw err;
    }

    lineas.push({ id_producto, cantidad: cantidadNum, precio_unitario: producto.precio });
  }

  return pedidoModel.crear({ id_mesa: mesa.id_mesa, items: lineas, token_sesion });
}

// Historial de pedidos abiertos de la mesa (formato de siempre). El token del
// QR está impreso en la mesa y no rota: por sí solo ya no muestra nada ([]),
// porque cualquiera con una foto del QR vería la cuenta de los clientes
// siguientes. Con el token de sesión (X-Sesion-Token) de la sesión activa de
// esa mesa, devuelve sus pedidos abiertos. El catálogo usa ahora
// GET /api/catalogo/sesion/estado.
async function listarPedidos(token, token_sesion) {
  const mesa = await buscarMesaPorToken(token);
  const sesion = token_sesion ? await mesaSesionModel.buscarPorToken(token_sesion) : undefined;
  if (!sesion || sesion.revocado_en || sesion.estado !== "activa" || sesion.id_mesa !== mesa.id_mesa) return [];
  return (await pedidoModel.listar({ id_mesa: mesa.id_mesa })).filter((p) => p.id_venta === null);
}

module.exports = { obtenerCatalogo, crearPedido, listarPedidos, buscarMesaPorToken };
