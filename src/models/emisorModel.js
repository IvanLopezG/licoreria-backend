const db = require("../db/db");

const CAMPOS = [
  "razon_social",
  "nit",
  "dv",
  "direccion",
  "municipio",
  "departamento",
  "telefono",
  "regimen",
  "titulo_documento",
  "leyenda_pie",
];

function obtener() {
  return db.prepare("SELECT * FROM emisor WHERE id = 1").get();
}

function crear(datos) {
  db.prepare(`
    INSERT INTO emisor (id, ${CAMPOS.join(", ")})
    VALUES (1, ${CAMPOS.map((c) => "@" + c).join(", ")})
  `).run(datos);
  return obtener();
}

function editar(datos) {
  db.prepare(`
    UPDATE emisor SET ${CAMPOS.map((c) => `${c} = @${c}`).join(", ")} WHERE id = 1
  `).run(datos);
  return obtener();
}

module.exports = { CAMPOS, obtener, crear, editar };
