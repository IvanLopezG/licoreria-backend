function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: "No autenticado." });
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        error: `No tienes permisos para esta acción. Rol requerido: ${rolesPermitidos.join(" o ")}.`,
      });
    }
    next();
  };
}

module.exports = requireRole;
