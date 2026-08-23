const mesaModel = require("../models/mesaModel");
const productoModel = require("../models/productoModel");

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

module.exports = { obtenerCatalogo, buscarMesaPorToken };
