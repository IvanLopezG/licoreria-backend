// US-19: serialización CSV mínima, reutilizada por los reportes de ventas
// (ventaController) y de movimientos de inventario (movimientoInventarioController).
function aCSV(filas, columnas) {
  const escapar = (valor) => {
    const texto = valor === null || valor === undefined ? "" : String(valor);
    return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const encabezado = columnas.map((c) => c.titulo).join(",");
  const cuerpo = filas.map((fila) => columnas.map((c) => escapar(fila[c.campo])).join(","));
  return [encabezado, ...cuerpo].join("\n");
}

module.exports = { aCSV };
