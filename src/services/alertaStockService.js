const alertaStockModel = require("../models/alertaStockModel");
const { hoyColombia } = require("../utils/fechaColombia");
const { ErrorValidacion } = require("../utils/errores");

// Parámetros de GET /api/alertas-stock: enteros de 1 a 365, con su valor por
// defecto si no llegan (o llegan vacíos).
const PARAMETROS = {
  ventana_dias: 30,
  cobertura_alerta_dias: 5,
  dias_objetivo: 14,
};
const MAXIMO = 365;

function leerParametro(nombre, valor) {
  if (valor === undefined || valor === "") return PARAMETROS[nombre];
  const texto = String(valor).trim();
  if (!/^\d+$/.test(texto) || Number(texto) < 1 || Number(texto) > MAXIMO) {
    throw new ErrorValidacion(`${nombre} debe ser un número entero entre 1 y ${MAXIMO}.`);
  }
  return Number(texto);
}

// "AAAA-MM-DD" menos n días (calendario, sin zona horaria).
function restarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

// Productos activos agotados, bajo el mínimo o que se agotarán pronto según lo
// vendido en los últimos ventana_dias días de Colombia (incluido hoy).
async function listar(query = {}, hoy = hoyColombia()) {
  const parametros = {};
  for (const nombre of Object.keys(PARAMETROS)) {
    parametros[nombre] = leerParametro(nombre, query[nombre]);
  }
  const desde = restarDias(hoy, parametros.ventana_dias - 1);
  const productos = await alertaStockModel.listar({ ...parametros, desde, hasta: hoy });

  const resumen = { total: productos.length, agotado: 0, bajo_minimo: 0, por_agotarse: 0 };
  for (const p of productos) resumen[p.estado] += 1;

  return {
    parametros: { ...parametros, desde, hasta: hoy, zona_horaria: "America/Bogota" },
    resumen,
    productos,
  };
}

module.exports = { listar, PARAMETROS };
