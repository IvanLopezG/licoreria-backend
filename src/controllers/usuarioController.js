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

// Edición parcial (nombre, rol, activo, password). La bitácora guarda los
// valores anterior y nuevo de nombre, rol y activo, y de la contraseña solo
// "contraseña cambiada".
async function editar(req, res) {
  const { usuario, detalle } = await usuarioService.editarUsuario(req.params.id, req.body, req.usuario);
  req.auditoria = { accion: "editar", entidad: "usuarios", id_entidad: usuario.id_usuario, detalle };
  return res.json(usuario);
}

module.exports = { crear, listar, editar };
