const bcrypt = require("bcryptjs");
const usuarioModel = require("../models/usuarioModel");

const ROLES_VALIDOS = ["administrador", "mesero", "cajero"];
const SALT_ROUNDS = 10;

function crearUsuario({ nombre, usuario_login, password, rol }) {
  if (!nombre || !usuario_login || !password || !rol) {
    const err = new Error("nombre, usuario_login, password y rol son obligatorios.");
    err.status = 400;
    throw err;
  }

  if (!ROLES_VALIDOS.includes(rol)) {
    const err = new Error(`Rol inválido. Debe ser uno de: ${ROLES_VALIDOS.join(", ")}.`);
    err.status = 400;
    throw err;
  }

  if (usuarioModel.buscarPorLogin(usuario_login)) {
    const err = new Error("Ya existe un usuario con ese usuario_login.");
    err.status = 409;
    throw err;
  }

  const password_hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const usuario = usuarioModel.crear({ nombre, usuario_login, password_hash, rol });

  const { password_hash: _omit, ...usuarioSinPassword } = usuario;
  return usuarioSinPassword;
}

function listarUsuarios() {
  return usuarioModel.listar();
}

module.exports = { crearUsuario, listarUsuarios, ROLES_VALIDOS };
