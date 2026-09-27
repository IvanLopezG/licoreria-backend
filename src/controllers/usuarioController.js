const usuarioService = require("../services/usuarioService");

async function crear(req, res) {
  const nuevoUsuario = await usuarioService.crearUsuario(req.body);

  // El middleware de auditoría escribe el registro al ver este campo.
  req.auditoria = { accion: "crear", entidad: "usuarios", id_entidad: nuevoUsuario.id_usuario };

  return res.status(201).json(nuevoUsuario);
}

async function listar(req, res) {
  return res.json(await usuarioService.listarUsuarios());
}

module.exports = { crear, listar };
