const db = require("../db/db");

function registrar({ id_usuario, accion, entidad, id_entidad }) {
  const stmt = db.prepare(`
    INSERT INTO log_auditoria (id_usuario, accion, entidad, id_entidad)
    VALUES (@id_usuario, @accion, @entidad, @id_entidad)
  `);
  return stmt.run({ id_usuario, accion, entidad, id_entidad });
}

function listar({ id_usuario, entidad } = {}) {
  let query = `
    SELECT l.*, u.nombre AS usuario_nombre, u.usuario_login
    FROM log_auditoria l
    JOIN usuarios u ON u.id_usuario = l.id_usuario
    WHERE 1 = 1
  `;
  const params = {};
  if (id_usuario) {
    query += " AND l.id_usuario = @id_usuario";
    params.id_usuario = id_usuario;
  }
  if (entidad) {
    query += " AND l.entidad = @entidad";
    params.entidad = entidad;
  }
  query += " ORDER BY l.fecha_hora DESC";
  return db.prepare(query).all(params);
}

module.exports = { registrar, listar };
