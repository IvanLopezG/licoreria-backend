// Dígito de verificación (DV) del NIT colombiano, algoritmo de la DIAN (módulo 11):
// cada dígito, de derecha a izquierda, se multiplica por 3, 7, 13, 17, 19, ...;
// si el residuo de la suma entre 11 es 0 o 1, ese es el DV; si no, 11 - residuo.
const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

// Quita puntos, espacios y guiones de formato ("900.123.456" -> "900123456").
function normalizarNit(nit) {
  return String(nit ?? "").replace(/[.\s-]/g, "");
}

function esNitValido(nit) {
  return /^\d{5,15}$/.test(nit);
}

function calcularDv(nit) {
  const digitos = nit.split("").reverse();
  const suma = digitos.reduce((acc, d, i) => acc + Number(d) * PESOS[i], 0);
  const residuo = suma % 11;
  return String(residuo > 1 ? 11 - residuo : residuo);
}

module.exports = { normalizarNit, esNitValido, calcularDv };
