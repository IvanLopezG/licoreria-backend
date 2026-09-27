const resolucionService = require("../services/resolucionService");

// Resolución de numeración (solo administrador, ver emisor.routes.js).

async function obtener(req, res) {
  try {
    return res.json(await resolucionService.obtener());
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}

// La bitácora registra qué campos cambiaron, nunca sus valores (la clave
// técnica aparece solo como nombre de campo).
function auditar(req, accion, { id_secuencia, campos }) {
  req.auditoria = {
    accion,
    entidad: "secuencias_factura",
    id_entidad: id_secuencia,
    detalle: campos.length ? `Campos: ${campos.join(", ")}` : "Sin cambios",
  };
}

async function actualizar(req, res) {
  try {
    const { auditoria, ...respuesta } = await resolucionService.actualizar(req.body || {});
    auditar(req, "editar", auditoria);
    return res.json(respuesta);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function registrar(req, res) {
  try {
    const { auditoria, ...respuesta } = await resolucionService.registrar(req.body || {});
    auditar(req, "crear", auditoria);
    return res.status(201).json(respuesta);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { obtener, actualizar, registrar };
