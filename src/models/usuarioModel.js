const db = require("../db/db");

async function crear({ nombre, usuario_login, password_hash, rol }) {
  const { id_usuario } = await db.uno(
    `INSERT INTO usuarios (nombre, usuario_login, password_hash, rol)
     VALUES ($1, $2, $3, $4)
     RETURNING id_usuario`,
    [nombre, usuario_login, password_hash, rol]
  );
  return buscarPorId(id_usuario);
}

function buscarPorLogin(usuario_login) {
  return db.uno("SELECT * FROM usuarios WHERE usuario_login = $1", [usuario_login]);
}

function buscarPorId(id_usuario) {
  return db.uno("SELECT * FROM usuarios WHERE id_usuario = $1", [id_usuario]);
}

function listar() {
  return db.todos("SELECT id_usuario, nombre, usuario_login, rol, activo, fecha_creacion FROM usuarios ORDER BY id_usuario");
}

async function existeAdministrador() {
  const row = await db.uno("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'administrador'");
  return row.n > 0;
}

module.exports = { crear, buscarPorLogin, buscarPorId, listar, existeAdministrador };
