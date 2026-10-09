// US-19: serialización CSV mínima, reutilizada por los reportes de ventas
// (ventaController) y de movimientos de inventario (movimientoInventarioController).
//
// Por defecto: coma, "\n" y sin BOM (el formato de siempre; escenario-api.js lo
// compara byte a byte). Con OPCIONES_EXCEL: lo que abre bien Excel con
// configuración regional de Colombia (separador de lista ";", BOM para que lea
// UTF-8 y CRLF). El panel genera el CSV de productos con el mismo criterio
// (public/panel/csv.js).
const OPCIONES_EXCEL = { separador: ";", finDeLinea: "\r\n", bom: true };

function aCSV(filas, columnas, { separador = ",", finDeLinea = "\n", bom = false } = {}) {
  const necesitaComillas = separador === ","
    ? /[",\n]/
    : new RegExp(`["\r\n${separador},]`);
  const escapar = (valor) => {
    const texto = valor === null || valor === undefined ? "" : String(valor);
    return necesitaComillas.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const encabezado = columnas.map((c) => c.titulo).join(separador);
  const cuerpo = filas.map((fila) => columnas.map((c) => escapar(fila[c.campo])).join(separador));
  return (bom ? "﻿" : "") + [encabezado, ...cuerpo].join(finDeLinea);
}

module.exports = { aCSV, OPCIONES_EXCEL };
