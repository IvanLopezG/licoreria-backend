// Desde que auth.js consulta el usuario en la base en cada petición (corte
// inmediato al desactivarlo o cambiarle el rol), las pruebas sin base firman
// sus tokens con esta función: registra el usuario como activo con ese rol y
// reemplaza usuarioModel.buscarAcceso para que lo encuentre. Los ids que no
// se registraron aquí van a la función real (pruebas con base local).
const jwt = require("jsonwebtoken");
const usuarioModel = require("../../src/models/usuarioModel");

const real = usuarioModel.buscarAcceso;
const simulados = new Map();
usuarioModel.buscarAcceso = async (id_usuario, ...resto) =>
  simulados.has(id_usuario) ? { ...simulados.get(id_usuario) } : real(id_usuario, ...resto);

// Ids por rol cuando la prueba no elige uno (lejos de los de una base de prueba).
const ID_POR_ROL = { administrador: 900001, cajero: 900002, mesero: 900003 };
let siguiente = 900100;

function firmarToken(rol, { id_usuario, usuario_login } = {}) {
  const id = id_usuario ?? ID_POR_ROL[rol] ?? siguiente++;
  simulados.set(id, { id_usuario: id, rol, activo: 1 });
  return jwt.sign({ id_usuario: id, usuario_login: usuario_login ?? rol, rol }, process.env.JWT_SECRET);
}

module.exports = { firmarToken, simulados };
