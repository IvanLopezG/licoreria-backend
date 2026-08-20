const db = require("../db/db");

function crear({ nombre }) {
  const stmt = db.prepare("INSERT INTO categorias (nombre) VALUES (@nombre)");
  const info = stmt.run({ nombre });
  return buscarPorId(info.lastInsertRowid);
}

function buscarPorId(id_categoria) {
  return db.prepare("SELECT * FROM categorias WHERE id_categoria = ?").get(id_categoria);
}

function buscarPorNombre(nombre) {
  return db.prepare("SELECT * FROM categorias WHERE nombre = ?").get(nombre);
}

function listar() {
  return db.prepare("SELECT * FROM categorias ORDER BY nombre").all();
}

module.exports = { crear, buscarPorId, buscarPorNombre, listar };
