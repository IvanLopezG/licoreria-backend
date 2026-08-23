const crypto = require("crypto");
const db = require("../db/db");

function generarToken() {
  return crypto.randomBytes(16).toString("hex");
}

function crear({ numero }) {
  const stmt = db.prepare(`
    INSERT INTO mesas (numero, codigo_qr_token) VALUES (@numero, @codigo_qr_token)
  `);
  const info = stmt.run({ numero, codigo_qr_token: generarToken() });
  return buscarPorId(info.lastInsertRowid);
}

function buscarPorId(id_mesa) {
  return db.prepare("SELECT * FROM mesas WHERE id_mesa = ?").get(id_mesa);
}

function buscarPorToken(codigo_qr_token) {
  return db.prepare("SELECT * FROM mesas WHERE codigo_qr_token = ?").get(codigo_qr_token);
}

function buscarPorNumero(numero) {
  return db.prepare("SELECT * FROM mesas WHERE numero = ?").get(numero);
}

function listar() {
  return db.prepare("SELECT * FROM mesas ORDER BY numero").all();
}

function actualizarEstado(id_mesa, estado) {
  db.prepare("UPDATE mesas SET estado = ? WHERE id_mesa = ?").run(estado, id_mesa);
  return buscarPorId(id_mesa);
}

module.exports = { crear, buscarPorId, buscarPorToken, buscarPorNumero, listar, actualizarEstado };
