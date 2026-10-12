const reporteModel = require("../models/reporteModel");
const { PERIODOS, rangoPeriodo, leerFecha } = require("../utils/periodoReporte");
const { hoyColombia } = require("../utils/fechaColombia");
const { ErrorValidacion } = require("../utils/errores");

// Reporte de ventas y movimientos de inventario de un periodo (día, semana de
// lunes a domingo, mes o año) que contiene la fecha de referencia (por defecto,
// hoy en Colombia).
async function porPeriodo({ periodo, fecha }) {
  if (!PERIODOS.includes(periodo)) {
    throw new ErrorValidacion(`periodo es obligatorio. Debe ser uno de: ${PERIODOS.join(", ")}.`);
  }
  const fecha_referencia = fecha === undefined || fecha === "" ? hoyColombia() : fecha;
  if (!leerFecha(fecha_referencia)) {
    throw new ErrorValidacion("fecha debe ser una fecha válida con formato AAAA-MM-DD.");
  }
  const { desde, hasta } = rangoPeriodo(periodo, fecha_referencia);

  const [resumen, top_productos, productos_menos_vendidos, mov, ventas_por_dia] = await Promise.all([
    reporteModel.resumenVentas(desde, hasta),
    reporteModel.topProductos(desde, hasta),
    reporteModel.productosMenosVendidos(desde, hasta),
    reporteModel.totalesMovimientos(desde, hasta),
    reporteModel.ventasPorDia(desde, hasta),
  ]);

  return {
    periodo,
    fecha_referencia,
    rango: { desde, hasta, zona_horaria: "America/Bogota" },
    total_vendido: resumen.total_vendido,
    numero_ventas: resumen.numero_ventas,
    ticket_promedio: resumen.ticket_promedio,
    top_productos,
    productos_menos_vendidos,
    movimientos_inventario: {
      entradas: { movimientos: mov.entradas_movimientos, unidades: mov.entradas_unidades },
      salidas: { movimientos: mov.salidas_movimientos, unidades: mov.salidas_unidades },
      ajustes: { movimientos: mov.ajustes_movimientos, unidades: mov.ajustes_unidades },
    },
    ventas_por_dia,
  };
}

module.exports = { porPeriodo };
