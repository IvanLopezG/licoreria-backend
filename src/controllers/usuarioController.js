const usuarioService = require("../services/usuarioService");

async function crear(req, res) {
  try {
    const nuevoUsuario = await usuarioService.crearUsuario(req.body);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "usuarios", id_entidad: nuevoUsuario.id_usuario };

    return res.status(201).json(nuevoUsuario);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function listar(req, res) {
  return res.json(await usuarioService.listarUsuarios());
}

module.exports = { crear, listar };
