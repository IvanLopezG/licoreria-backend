// CSV para Excel con configuración regional de Colombia, generado en el
// navegador. Mismo criterio que el servidor con &excel=1 (src/utils/csv.js,
// OPCIONES_EXCEL): BOM UTF-8 (tildes y ñ), separador ";" y CRLF; un valor con
// ";", ",", comillas o saltos de línea va entre comillas.
const Csv = (() => {
  const SEPARADOR = ";";
  const FIN_DE_LINEA = "\r\n";

  function escapar(valor) {
    const texto = valor === null || valor === undefined ? "" : String(valor);
    return /[";,\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  }

  // columnas: [{ titulo, valor: (fila) => ... }]
  function generar(filas, columnas) {
    const lineas = [columnas.map((c) => escapar(c.titulo)).join(SEPARADOR)];
    for (const fila of filas) lineas.push(columnas.map((c) => escapar(c.valor(fila))).join(SEPARADOR));
    return "﻿" + lineas.join(FIN_DE_LINEA);
  }

  // Número con coma decimal y sin separador de miles, como lo lee Excel en
  // Colombia (45000.5 -> "45000,5"; con punto lo tomaría como miles).
  function numero(valor) {
    if (valor === null || valor === undefined || valor === "") return "";
    return String(Number(valor)).replace(".", ",");
  }

  // Código numérico que debe quedar como texto (código de barras): sin esto
  // Excel muestra 7702004003003 como 7,702E+12 y quita los ceros a la
  // izquierda. ="..." lo deja como texto; solo se usa si son solo dígitos.
  function codigo(valor) {
    if (valor === null || valor === undefined) return "";
    const texto = String(valor);
    return /^\d+$/.test(texto) ? `="${texto}"` : texto;
  }

  // Fecha local del navegador (YYYY-MM-DD) para el nombre del archivo.
  function nombreConFecha(base) {
    const d = new Date();
    const dos = (n) => String(n).padStart(2, "0");
    return `${base}-${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}.csv`;
  }

  // contenido: texto (se convierte en Blob) o un Blob ya descargado.
  function descargar(contenido, nombreArchivo) {
    const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return { generar, numero, codigo, nombreConFecha, descargar };
})();
