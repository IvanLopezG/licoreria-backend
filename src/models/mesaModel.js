const crypto = require("crypto");
const db = require("../db/db");

function generarToken() {
  return crypto.randomBytes(16).toString("hex");
}

async function crear({ numero }) {
  const { id_mesa } = await db.uno(
    "INSERT INTO mesas (numero, codigo_qr_token) VALUES ($1, $2) RETURNING id_mesa",
    [numero, generarToken()]
  );
  return buscarPorId(id_mesa);
}

function buscarPorId(id_mesa, cx = db) {
  return cx.uno("SELECT * FROM mesas WHERE id_mesa = $1", [id_mesa]);
}

function buscarPorToken(codigo_qr_token) {
  return db.uno("SELECT * FROM mesas WHERE codigo_qr_token = $1", [codigo_qr_token]);
}

function buscarPorNumero(numero) {
  return db.uno("SELECT * FROM mesas WHERE numero = $1", [numero]);
}

function listar() {
  return db.todos("SELECT * FROM mesas ORDER BY numero");
}

async function actualizarEstado(id_mesa, estado, cx = db) {
  await cx.ejecutar("UPDATE mesas SET estado = $1 WHERE id_mesa = $2", [estado, id_mesa]);
  return buscarPorId(id_mesa, cx);
}

module.exports = { crear, buscarPorId, buscarPorToken, buscarPorNumero, listar, actualizarEstado };
