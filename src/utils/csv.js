// US-19: serialización CSV de los reportes de ventas (ventaController) y de
// movimientos de inventario (movimientoInventarioController).
//
// Por defecto: coma, "\n" y sin BOM (el formato de siempre; escenario-api.js lo
// compara byte a byte). Con { excel: true } (opción &excel=1 de los reportes):
// el formato para Excel en configuración regional de Colombia, definido una sola
// vez en public/panel/csv.js y compartido con el panel. Cada columna puede pedir
// cómo se escribe su valor en ese modo: excel: "numero" (coma decimal) o
// "codigo" (solo dígitos -> texto). Sin modo Excel esa marca no se usa.
const CsvExcel = require("../../public/panel/csv.js");

const FORMATO_EXCEL = { numero: CsvExcel.numero, codigo: CsvExcel.codigo };

function aCSV(filas, columnas, { excel = false } = {}) {
  if (excel) {
    return CsvExcel.generar(filas, columnas.map((c) => {
      const formato = FORMATO_EXCEL[c.excel];
      return { titulo: c.titulo, valor: (fila) => (formato ? formato(fila[c.campo]) : fila[c.campo]) };
    }));
  }

  const escapar = (valor) => {
    const texto = valor === null || valor === undefined ? "" : String(valor);
    return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const encabezado = columnas.map((c) => c.titulo).join(",");
  const cuerpo = filas.map((fila) => columnas.map((c) => escapar(fila[c.campo])).join(","));
  return [encabezado, ...cuerpo].join("\n");
}

// Respuesta de descarga común a los reportes: mismos encabezados de siempre.
function enviarCSV(res, filas, columnas, { archivo, excel = false }) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=${archivo}`);
  return res.send(aCSV(filas, columnas, { excel }));
}

module.exports = { aCSV, enviarCSV };
