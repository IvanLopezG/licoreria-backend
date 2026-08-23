const mesaModel = require("../models/mesaModel");
const ventaModel = require("../models/ventaModel");

// La mesa solo pasa a "ocupada" al recibir un pedido (US-12) y solo vuelve
// a "libre" al cerrar cuenta (US-14); si no está ocupada no hay nada que cobrar.
function cerrarCuentaMesa(id_mesa, id_usuario) {
  const mesa = mesaModel.buscarPorId(id_mesa);
  if (!mesa) {
    const err = new Error("Mesa no encontrada.");
    err.status = 404;
    throw err;
  }
  if (mesa.estado !== "ocupada") {
    const err = new Error("La mesa no está ocupada; no hay cuenta que cerrar.");
    err.status = 400;
    throw err;
  }

  return ventaModel.cerrarCuentaMesa(id_mesa, id_usuario);
}

module.exports = { cerrarCuentaMesa };
