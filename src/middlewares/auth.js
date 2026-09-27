const jwt = require("jsonwebtoken");
const { ErrorNoAutenticado } = require("../utils/errores");

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const [tipo, token] = header.split(" ");

  if (tipo !== "Bearer" || !token) {
    return next(new ErrorNoAutenticado("Token no proporcionado."));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload; // { id_usuario, usuario_login, rol }
    return next();
  } catch {
    return next(new ErrorNoAutenticado("Token inválido o expirado."));
  }
}

module.exports = auth;
