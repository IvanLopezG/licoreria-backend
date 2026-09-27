const { ErrorNoAutenticado, ErrorPermiso } = require("../utils/errores");

function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return next(new ErrorNoAutenticado("No autenticado."));
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return next(new ErrorPermiso(`No tienes permisos para esta acción. Rol requerido: ${rolesPermitidos.join(" o ")}.`));
    }
    return next();
  };
}

module.exports = requireRole;
