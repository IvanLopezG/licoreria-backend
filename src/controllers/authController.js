const authService = require("../services/authService");

async function login(req, res) {
  const { usuario_login, password } = req.body;

  if (!usuario_login || !password) {
    return res.status(400).json({ error: "usuario_login y password son obligatorios." });
  }

  try {
    const resultado = await authService.login(usuario_login, password);
    return res.json(resultado);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }
}

function me(req, res) {
  // req.usuario lo llena el middleware de autenticación
  return res.json({ usuario: req.usuario });
}

module.exports = { login, me };
