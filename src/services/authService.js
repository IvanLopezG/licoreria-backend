const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const usuarioModel = require("../models/usuarioModel");

const MENSAJE_CREDENCIALES_INVALIDAS = "Usuario o contraseña incorrectos.";

async function login(usuario_login, password) {
  const usuario = await usuarioModel.buscarPorLogin(usuario_login);

  if (!usuario || !usuario.activo) {
    // Mismo mensaje que una contraseña incorrecta: no revelamos si el
    // usuario existe o no (buena práctica de seguridad, RNF01).
    const err = new Error(MENSAJE_CREDENCIALES_INVALIDAS);
    err.status = 401;
    throw err;
  }

  const passwordValida = bcrypt.compareSync(password, usuario.password_hash);
  if (!passwordValida) {
    const err = new Error(MENSAJE_CREDENCIALES_INVALIDAS);
    err.status = 401;
    throw err;
  }

  const payload = {
    id_usuario: usuario.id_usuario,
    usuario_login: usuario.usuario_login,
    rol: usuario.rol,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "2h",
  });

  return {
    token,
    usuario: {
      id_usuario: usuario.id_usuario,
      nombre: usuario.nombre,
      usuario_login: usuario.usuario_login,
      rol: usuario.rol,
    },
  };
}

module.exports = { login };
