// Rango de fechas (calendario de Colombia) de un periodo de reporte.
//
// rangoPeriodo("semana", "2026-10-08") → { desde: "2026-10-05", hasta: "2026-10-11" }
// Ambos extremos inclusivos, "AAAA-MM-DD". La semana va de lunes a domingo (ISO).
// Las cuentas se hacen con Date.UTC solo como calendario: no hay horas ni zonas
// aquí; el paso a UTC de fecha_hora lo hace la consulta (models/reporteModel.js).
const PERIODOS = ["dia", "semana", "mes", "anio"];

const aTexto = (fecha) => fecha.toISOString().slice(0, 10);

// "AAAA-MM-DD" real (rechaza 2026-02-30) → Date en UTC, o null.
function leerFecha(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor));
  if (!m) return null;
  const fecha = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return aTexto(fecha) === valor ? fecha : null;
}

// null si el periodo o la fecha no son válidos.
function rangoPeriodo(periodo, fechaReferencia) {
  if (!PERIODOS.includes(periodo)) return null;
  const f = leerFecha(fechaReferencia);
  if (!f) return null;
  const anio = f.getUTCFullYear();
  const mes = f.getUTCMonth();
  const dia = f.getUTCDate();

  let desde;
  let hasta;
  if (periodo === "dia") {
    desde = f;
    hasta = f;
  } else if (periodo === "semana") {
    const desdeLunes = (f.getUTCDay() + 6) % 7; // getUTCDay: 0 = domingo
    desde = new Date(Date.UTC(anio, mes, dia - desdeLunes));
    hasta = new Date(Date.UTC(anio, mes, dia - desdeLunes + 6));
  } else if (periodo === "mes") {
    desde = new Date(Date.UTC(anio, mes, 1));
    hasta = new Date(Date.UTC(anio, mes + 1, 0)); // día 0 del mes siguiente = último de este
  } else {
    desde = new Date(Date.UTC(anio, 0, 1));
    hasta = new Date(Date.UTC(anio, 11, 31));
  }
  return { desde: aTexto(desde), hasta: aTexto(hasta) };
}

module.exports = { PERIODOS, rangoPeriodo, leerFecha };
