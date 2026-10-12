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

// Lo mínimo que necesita el middleware de autenticación en cada petición.
function buscarAcceso(id_usuario) {
  return db.uno("SELECT id_usuario, rol, activo FROM usuarios WHERE id_usuario = $1", [id_usuario]);
}

const CAMPOS_PUBLICOS = "id_usuario, nombre, usuario_login, rol, activo, fecha_creacion";

function listar() {
  return db.todos(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios ORDER BY id_usuario`);
}

function buscarPublico(id_usuario, cx = db) {
  return cx.uno(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id_usuario = $1`, [id_usuario]);
}

// Bloquea (FOR UPDATE, dentro de la transacción de cx) el usuario a editar y,
// si conAdministradores, también a todos los administradores activos, siempre en
// orden de id: dos administradores que se desactivan entre sí a la vez se turnan
// (el segundo espera y luego cuenta con el cambio del primero) en vez de
// bloquearse mutuamente. En READ COMMITTED, tras esperar, Postgres vuelve a
// evaluar el WHERE con la fila ya actualizada.
function bloquearParaEditar(id_usuario, conAdministradores, cx) {
  const where = conAdministradores ? "id_usuario = $1 OR (rol = 'administrador' AND activo = 1)" : "id_usuario = $1";
  return cx.todos(`SELECT id_usuario, nombre, usuario_login, rol, activo FROM usuarios WHERE ${where} ORDER BY id_usuario FOR UPDATE`, [
    id_usuario,
  ]);
}

// campos: solo nombre, rol, activo y password_hash (los decide el servicio).
async function actualizar(id_usuario, campos, cx) {
  const nombres = Object.keys(campos);
  if (nombres.length === 0) return;
  const asignaciones = nombres.map((c, i) => `${c} = $${i + 2}`).join(", ");
  await cx.ejecutar(`UPDATE usuarios SET ${asignaciones} WHERE id_usuario = $1`, [id_usuario, ...nombres.map((c) => campos[c])]);
}

async function existeAdministrador() {
  const row = await db.uno("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'administrador'");
  return row.n > 0;
}

module.exports = {
  crear,
  buscarPorLogin,
  buscarPorId,
  buscarAcceso,
  buscarPublico,
  bloquearParaEditar,
  actualizar,
  listar,
  existeAdministrador,
};
