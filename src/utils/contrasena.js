// Reglas de la contraseña al crear un usuario o cambiársela (no al iniciar
// sesión: las contraseñas que ya existen siguen funcionando aunque sean cortas).
// - Mínimo 8 caracteres (se cuentan caracteres Unicode, no bytes).
// - Máximo 72 bytes en UTF-8: bcrypt ignora lo que pase de 72 bytes, así que
//   dos contraseñas largas que solo difieren al final serían la misma. Una
//   tilde o una ñ ocupan 2 bytes y un emoji 4.
// Los espacios cuentan (no se recorta: la contraseña se guarda tal cual).
const { ErrorValidacion } = require("./errores");

const MINIMO_CARACTERES = 8;
const MAXIMO_BYTES = 72;

function validarContrasena(password) {
  if (typeof password !== "string") throw new ErrorValidacion("La contraseña debe ser un texto.");
  if ([...password].length < MINIMO_CARACTERES) {
    throw new ErrorValidacion(`La contraseña debe tener al menos ${MINIMO_CARACTERES} caracteres.`);
  }
  if (Buffer.byteLength(password, "utf8") > MAXIMO_BYTES) {
    throw new ErrorValidacion(
      `La contraseña es demasiado larga: máximo ${MAXIMO_BYTES} caracteres (las tildes y la ñ cuentan doble).`
    );
  }
}

module.exports = { validarContrasena, MINIMO_CARACTERES, MAXIMO_BYTES };
