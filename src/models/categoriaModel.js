const db = require("../db/db");

async function crear({ nombre }) {
  const { id_categoria } = await db.uno("INSERT INTO categorias (nombre) VALUES ($1) RETURNING id_categoria", [nombre]);
  return buscarPorId(id_categoria);
}

function buscarPorId(id_categoria) {
  return db.uno("SELECT * FROM categorias WHERE id_categoria = $1", [id_categoria]);
}

function buscarPorNombre(nombre) {
  return db.uno("SELECT * FROM categorias WHERE nombre = $1", [nombre]);
}

// COLLATE "C": mismo orden binario que SQLite (mayúsculas antes que minúsculas).
function listar() {
  return db.todos('SELECT * FROM categorias ORDER BY nombre COLLATE "C"');
}

module.exports = { crear, buscarPorId, buscarPorNombre, listar };
