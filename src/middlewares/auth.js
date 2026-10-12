const jwt = require("jsonwebtoken");
const usuarioModel = require("../models/usuarioModel");
const { ErrorNoAutenticado } = require("../utils/errores");

const TOKEN_INVALIDO = "Token inválido o expirado.";

// Verifica el JWT y, en cada petición, consulta el usuario en la base: si ya no
// existe o está inactivo, 401 al instante (sin esperar a que venza el token), y
// el rol que vale es el de la base, así un cambio de rol aplica de inmediato.
// req.usuario conserva la forma de siempre (el contenido del token), solo con
// el rol actualizado. Se llama usuarioModel.buscarAcceso como propiedad del
// módulo para que las pruebas sin base puedan reemplazarla.
async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const [tipo, token] = header.split(" ");

  if (tipo !== "Bearer" || !token) {
    throw new ErrorNoAutenticado("Token no proporcionado.");
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new ErrorNoAutenticado(TOKEN_INVALIDO);
  }

  const id = Number(payload && payload.id_usuario);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorNoAutenticado(TOKEN_INVALIDO);

  // Un error de la base (caída) sigue al manejador central como 500: nunca se
  // deja pasar una petición sin saber si el usuario sigue activo.
  const usuario = await usuarioModel.buscarAcceso(id);
  if (!usuario || Number(usuario.activo) !== 1) throw new ErrorNoAutenticado(TOKEN_INVALIDO);

  req.usuario = { ...payload, rol: usuario.rol }; // { id_usuario, usuario_login, rol, iat, exp }
  return next();
}

module.exports = auth;
