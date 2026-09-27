const bcrypt = require("bcryptjs");
const usuarioModel = require("../models/usuarioModel");
const { ErrorConflicto, ErrorValidacion } = require("../utils/errores");

const ROLES_VALIDOS = ["administrador", "mesero", "cajero"];
const SALT_ROUNDS = 10;

async function crearUsuario({ nombre, usuario_login, password, rol }) {
  if (!nombre || !usuario_login || !password || !rol) {
    throw new ErrorValidacion("nombre, usuario_login, password y rol son obligatorios.");
  }

  if (!ROLES_VALIDOS.includes(rol)) {
    throw new ErrorValidacion(`Rol inválido. Debe ser uno de: ${ROLES_VALIDOS.join(", ")}.`);
  }

  if (await usuarioModel.buscarPorLogin(usuario_login)) {
    throw new ErrorConflicto("Ya existe un usuario con ese usuario_login.");
  }

  const password_hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const usuario = await usuarioModel.crear({ nombre, usuario_login, password_hash, rol });

  const { password_hash: _omit, ...usuarioSinPassword } = usuario;
  return usuarioSinPassword;
}

function listarUsuarios() {
  return usuarioModel.listar();
}

module.exports = { crearUsuario, listarUsuarios, ROLES_VALIDOS };
