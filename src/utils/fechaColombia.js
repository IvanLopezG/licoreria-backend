// Fecha de hoy en Colombia (America/Bogota), "AAAA-MM-DD".
//
// La vigencia de la resolución de numeración es una fecha de calendario
// colombiana: el último día debe poder facturar hasta las 11:59 p. m. hora de
// Colombia. Comparar con la fecha UTC la cortaba a las 7:00 p. m.
//
// Colombia es UTC-5 todo el año (sin horario de verano), así que basta un
// desfase fijo; no depende de la zona horaria del servidor (Render usa UTC).
const DESFASE_COLOMBIA_MS = -5 * 60 * 60 * 1000;

function hoyColombia(ahora = new Date()) {
  return new Date(ahora.getTime() + DESFASE_COLOMBIA_MS).toISOString().slice(0, 10);
}

module.exports = { hoyColombia };
