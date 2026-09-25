const PDFDocument = require("pdfkit");

// Tirilla de 80 mm (impresora POS). El alto de la página depende de cuántas
// líneas tenga la factura: se dibuja una vez en una página muy alta solo para
// medir, y luego se dibuja de verdad con el alto exacto.
const ANCHO = 226.77; // 80 mm en puntos
const MARGEN = 12;
const ALTO_MEDICION = 20000;

const formatoPesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
const formatoFecha = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  dateStyle: "short",
  timeStyle: "short",
  hour12: false,
});

// Intl usa espacios no separables; se normalizan para la fuente estándar del PDF.
const pesos = (valor) => formatoPesos.format(valor).replace(/\s/g, " ");
const porcentaje = (bps) => `${(bps / 100).toLocaleString("es-CO")} %`;
// fecha_expedicion se guarda en UTC ("2026-09-24 03:53:39"); se muestra en hora de Colombia.
const fechaLocal = (utc) => formatoFecha.format(new Date(utc.replace(" ", "T") + "Z")).replace(/\s/g, " ");

const FORMAS_PAGO = {
  efectivo: "Efectivo",
  tarjeta_debito: "Tarjeta débito",
  tarjeta_credito: "Tarjeta crédito",
  transferencia: "Transferencia",
};

// Resume los impuestos por tipo y tarifa, como exige discriminarlos (Art. 617 E.T.).
function impuestosPorTarifa(items) {
  const grupos = new Map();
  for (const item of items) {
    for (const [nombre, tasa, valor] of [
      ["IVA", item.tasa_iva_bps, item.valor_iva],
      ["INC", item.tasa_inc_bps, item.valor_inc],
    ]) {
      if (tasa === 0) continue;
      const clave = `${nombre}|${tasa}`;
      const grupo = grupos.get(clave) || { nombre, tasa, base: 0, valor: 0 };
      grupo.base += item.base_linea;
      grupo.valor += valor;
      grupos.set(clave, grupo);
    }
  }
  return [...grupos.values()];
}

function dibujar(doc, f) {
  const ancho = ANCHO - MARGEN * 2;
  const centrado = { width: ancho, align: "center" };
  const separador = () => {
    doc.moveDown(0.3);
    doc.moveTo(MARGEN, doc.y).lineTo(ANCHO - MARGEN, doc.y).dash(2, { space: 2 }).stroke().undash();
    doc.moveDown(0.4);
  };
  // Texto a la izquierda y valor alineado a la derecha en el mismo renglón.
  const fila = (izquierda, derecha, opciones = {}) => {
    const y = doc.y;
    doc.font(opciones.negrita ? "Helvetica-Bold" : "Helvetica").fontSize(opciones.tamano || 8);
    doc.text(derecha, MARGEN, y, { width: ancho, align: "right" });
    const altoDerecha = doc.y;
    doc.text(izquierda, MARGEN, y, { width: ancho - doc.widthOfString(derecha) - 6 });
    doc.y = Math.max(doc.y, altoDerecha);
  };

  // Encabezado del emisor
  doc.font("Helvetica-Bold").fontSize(11).text(f.titulo_documento.toUpperCase(), MARGEN, MARGEN, centrado);
  doc.moveDown(0.3);
  doc.fontSize(9).text(f.emisor_razon_social, centrado);
  doc.font("Helvetica").fontSize(8);
  doc.text(`NIT ${f.emisor_nit}-${f.emisor_dv}`, centrado);
  doc.text(f.emisor_regimen, centrado);
  doc.text(f.emisor_direccion, centrado);
  doc.text(`${f.emisor_municipio}, ${f.emisor_departamento}`, centrado);
  if (f.emisor_telefono) doc.text(`Tel. ${f.emisor_telefono}`, centrado);

  separador();
  fila("No.", f.numero_completo, { negrita: true, tamano: 10 });
  fila("Fecha de expedición", fechaLocal(f.fecha_expedicion));
  fila("Venta", f.mesa_numero ? `Mesa ${f.mesa_numero}` : "Mostrador");
  fila("Consumo", f.tipo_consumo === "en_sitio" ? "En el sitio" : "Para llevar");
  fila("Atendió", f.usuario_nombre);
  if (f.estado === "anulada") {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(11).text("ANULADA", centrado);
    doc.font("Helvetica").fontSize(8).text(`Motivo: ${f.motivo_anulacion}`, centrado);
    if (f.fecha_anulacion) doc.text(`Anulada el ${fechaLocal(f.fecha_anulacion)}`, centrado);
  }

  separador();
  fila("Cliente", f.cliente_nombre);
  if (f.cliente_num_doc) {
    const documento = f.cliente_dv ? `${f.cliente_num_doc}-${f.cliente_dv}` : f.cliente_num_doc;
    fila(f.cliente_tipo_doc, documento);
  }

  separador();
  fila("Descripción", "Total", { negrita: true });
  doc.moveDown(0.2);
  for (const item of f.items) {
    doc.font("Helvetica").fontSize(8).text(item.descripcion, MARGEN, doc.y, { width: ancho });
    const impuesto = item.tasa_inc_bps
      ? ` · INC ${porcentaje(item.tasa_inc_bps)}`
      : item.tasa_iva_bps
        ? ` · IVA ${porcentaje(item.tasa_iva_bps)}`
        : " · Sin impuesto";
    fila(`  ${item.cantidad} x ${pesos(item.precio_unitario)}${impuesto}`, pesos(item.total_linea));
    doc.moveDown(0.2);
  }

  separador();
  fila("Subtotal (base gravable)", pesos(f.subtotal));
  for (const g of impuestosPorTarifa(f.items)) {
    fila(`${g.nombre} ${porcentaje(g.tasa)} (base ${pesos(g.base)})`, pesos(g.valor));
  }
  if (f.total_iva === 0) fila("IVA", pesos(0));
  if (f.total_inc === 0) fila("Impuesto al consumo (INC)", pesos(0));
  fila("Total impuestos", pesos(f.total_impuestos));
  doc.moveDown(0.2);
  fila("TOTAL A PAGAR", pesos(f.total), { negrita: true, tamano: 11 });
  doc.moveDown(0.2);
  fila("Forma de pago", FORMAS_PAGO[f.forma_pago] || f.forma_pago);

  separador();
  doc.font("Helvetica").fontSize(7);
  if (f.resolucion_numero) {
    const rango = `${f.prefijo || ""}${f.rango_desde} al ${f.prefijo || ""}${f.rango_hasta ?? ""}`;
    doc.text(`Resolución DIAN No. ${f.resolucion_numero} del ${f.resolucion_fecha}. Numeración del ${rango}.`, centrado);
    doc.moveDown(0.3);
  }
  doc.text(f.leyenda_pie, centrado);
  doc.moveDown(0.3);
  doc.text("¡Gracias por su compra!", centrado);
}

function generarPdfFactura(factura) {
  const medicion = new PDFDocument({ size: [ANCHO, ALTO_MEDICION], margin: MARGEN });
  dibujar(medicion, factura);
  const alto = Math.ceil(medicion.y + MARGEN + 4);
  medicion.end();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [ANCHO, alto],
      margin: MARGEN,
      info: { Title: `${factura.titulo_documento} ${factura.numero_completo}` },
    });
    const partes = [];
    doc.on("data", (parte) => partes.push(parte));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    dibujar(doc, factura);
    doc.end();
  });
}

module.exports = { generarPdfFactura };
