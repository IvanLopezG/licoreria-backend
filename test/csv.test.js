// utils/csv.js: el CSV de siempre no cambia, y el modo Excel (BOM, ";" y CRLF)
// escapa separadores, comillas y saltos de línea dentro de los valores.
const test = require("node:test");
const assert = require("node:assert");
const { aCSV } = require("../src/utils/csv");

const columnas = [
  { titulo: "producto", campo: "nombre" },
  { titulo: "cantidad", campo: "cantidad" },
];
const filas = [
  { nombre: "Aguardiente Antioqueño", cantidad: 3 },
  { nombre: 'Ron "Viejo", 750 ml', cantidad: 2 },
  { nombre: "Papas; grandes\r\nx2", cantidad: null },
];

test("sin opciones: coma, \\n y sin BOM (formato de siempre)", () => {
  assert.strictEqual(
    aCSV(filas.slice(0, 2), columnas),
    'producto,cantidad\nAguardiente Antioqueño,3\n"Ron ""Viejo"", 750 ml",2'
  );
});

test("modo Excel: BOM, punto y coma, CRLF y comillas donde hace falta", () => {
  const csv = aCSV(filas, columnas, { excel: true });
  assert.ok(csv.startsWith("﻿"));
  assert.strictEqual(
    csv.slice(1),
    [
      "producto;cantidad",
      "Aguardiente Antioqueño;3",
      '"Ron ""Viejo"", 750 ml";2',
      '"Papas; grandes\r\nx2";',
    ].join("\r\n")
  );
});
