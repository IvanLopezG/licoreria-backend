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

function obtener(cx = db) {
  return cx.uno("SELECT * FROM emisor WHERE id = 1");
}

async function crear(datos) {
  await db.ejecutar(
    `INSERT INTO emisor (id, ${CAMPOS.join(", ")})
     VALUES (1, ${CAMPOS.map((_, i) => `$${i + 1}`).join(", ")})`,
    CAMPOS.map((c) => datos[c])
  );
  return obtener();
}

async function editar(datos) {
  await db.ejecutar(
    `UPDATE emisor SET ${CAMPOS.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = 1`,
    CAMPOS.map((c) => datos[c])
  );
  return obtener();
}

module.exports = { CAMPOS, obtener, crear, editar };
