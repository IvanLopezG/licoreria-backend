const authService = require("../services/authService");
const { ErrorValidacion } = require("../utils/errores");

// Los errores (datos faltantes, credenciales inválidas) los responde el
// manejador central (middlewares/manejoErrores.js).
async function login(req, res) {
  const { usuario_login, password } = req.body ?? {};

  if (!usuario_login || !password) {
    throw new ErrorValidacion("usuario_login y password son obligatorios.");
  }

  return res.json(await authService.login(usuario_login, password));
}

function me(req, res) {
  // req.usuario lo llena el middleware de autenticación
  return res.json({ usuario: req.usuario });
}

module.exports = { login, me };
