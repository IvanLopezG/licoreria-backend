const logAuditoriaModel = require("../models/logAuditoriaModel");

// El controlador solo necesita fijar req.auditoria = { accion, entidad, id_entidad }
// antes de responder; este middleware se encarga de escribir el registro,
// para que ningún servicio tenga que acordarse de hacerlo manualmente.
function auditoria(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (req.auditoria && req.usuario) {
      try {
        logAuditoriaModel.registrar({
          id_usuario: req.usuario.id_usuario,
          accion: req.auditoria.accion,
          entidad: req.auditoria.entidad,
          id_entidad: req.auditoria.id_entidad,
        });
      } catch (err) {
        console.error("No se pudo registrar la auditoría:", err.message);
      }
    }
    return originalJson(body);
  };

  next();
}

module.exports = auditoria;
