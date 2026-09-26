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
  "modo_facturacion",
  "ambiente_dian",
  "correo_electronico",
  "tipo_persona",
  "responsable_iva",
  "responsable_inc",
  "proveedor_tecnologico",
  "certificado_digital_nombre",
  "certificado_digital_vencimiento",
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
