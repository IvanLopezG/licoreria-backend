// Reglas de la contraseña (utils/contrasena.js): mínimo 8 caracteres y máximo
// 72 bytes en UTF-8 (lo que bcrypt usa). Función pura: sin base de datos.
const test = require("node:test");
const assert = require("node:assert");
const { validarContrasena } = require("../src/utils/contrasena");

const rechaza = (valor, patron) =>
  assert.throws(() => validarContrasena(valor), (err) => err.status === 400 && patron.test(err.message), String(valor));

test("contraseña: mínimo 8 caracteres, máximo 72 bytes, solo texto", () => {
  for (const valida of ["12345678", "Clave Segura 2026", "a".repeat(72), "ñ".repeat(36), "contraseña"]) {
    assert.doesNotThrow(() => validarContrasena(valida), valida);
  }
  rechaza("1234567", /al menos 8/);
  rechaza("", /al menos 8/);
  rechaza("😀😀😀😀😀😀😀", /al menos 8/); // 7 caracteres aunque sean 28 bytes
  rechaza("a".repeat(73), /demasiado larga/);
  rechaza("ñ".repeat(37), /demasiado larga/); // 37 caracteres, 74 bytes
  rechaza(undefined, /texto/);
  rechaza(12345678, /texto/);
  rechaza(["12345678"], /texto/);
});
