const db = require("../db/db");

function crear({ nombre, usuario_login, password_hash, rol }) {
  const stmt = db.prepare(`
    INSERT INTO usuarios (nombre, usuario_login, password_hash, rol)
    VALUES (@nombre, @usuario_login, @password_hash, @rol)
  `);
  const info = stmt.run({ nombre, usuario_login, password_hash, rol });
  return buscarPorId(info.lastInsertRowid);
}

function buscarPorLogin(usuario_login) {
  return db.prepare("SELECT * FROM usuarios WHERE usuario_login = ?").get(usuario_login);
}

function buscarPorId(id_usuario) {
  return db.prepare("SELECT * FROM usuarios WHERE id_usuario = ?").get(id_usuario);
}

function listar() {
  return db
    .prepare("SELECT id_usuario, nombre, usuario_login, rol, activo, fecha_creacion FROM usuarios ORDER BY id_usuario")
    .all();
}

function existeAdministrador() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'administrador'").get();
  return row.n > 0;
}

module.exports = { crear, buscarPorLogin, buscarPorId, listar, existeAdministrador };
