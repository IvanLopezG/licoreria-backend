const db = require("../db/db");

function registrar({ id_usuario, accion, entidad, id_entidad }) {
  return db.ejecutar(
    `INSERT INTO log_auditoria (id_usuario, accion, entidad, id_entidad)
     VALUES ($1, $2, $3, $4)`,
    [id_usuario, accion, entidad, id_entidad]
  );
}

function listar({ id_usuario, entidad } = {}) {
  const f = db.filtros();
  if (id_usuario) f.agregar("l.id_usuario = ?", id_usuario);
  if (entidad) f.agregar("l.entidad = ?", entidad);
  // id_log desempata registros del mismo segundo en el orden en que SQLite los devolvía.
  return db.todos(
    `SELECT l.*, u.nombre AS usuario_nombre, u.usuario_login
     FROM log_auditoria l
     JOIN usuarios u ON u.id_usuario = l.id_usuario
     WHERE 1 = 1${f.where()}
     ORDER BY l.fecha_hora DESC, l.id_log ASC`,
    f.params
  );
}

module.exports = { registrar, listar };
