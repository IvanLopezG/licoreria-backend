// Cálculo de impuestos de una línea de factura.
//
// Reglas (confirmar tarifas con el contador):
// - El precio de venta YA incluye el impuesto (Ley 1480, precio al público);
//   la base se despeja: base = total / (1 + tasa).
// - Consumo en el sitio (mesa): aplica INC (Art. 512-1 E.T.) con la tasa del
//   producto. Venta para llevar (mostrador): aplica IVA. Nunca ambos.
// - Tasas en puntos básicos (1900 = 19 %); valores en pesos enteros. Se
//   redondea por línea y el impuesto es la diferencia, así base + impuesto
//   siempre suma exactamente el total cobrado.

const TIPOS_CONSUMO = ["en_sitio", "para_llevar"];

function calcularLinea({ cantidad, precio_unitario, tasa_iva_bps, tasa_inc_bps, tipo_consumo }) {
  const precio = Math.round(precio_unitario);
  const total_linea = cantidad * precio;

  const iva = tipo_consumo === "para_llevar" ? tasa_iva_bps : 0;
  const inc = tipo_consumo === "en_sitio" ? tasa_inc_bps : 0;

  const base_linea = Math.round((total_linea * 10000) / (10000 + iva + inc));
  const impuesto = total_linea - base_linea;

  return {
    cantidad,
    precio_unitario: precio,
    base_linea,
    tasa_iva_bps: iva,
    valor_iva: iva > 0 ? impuesto : 0,
    tasa_inc_bps: inc,
    valor_inc: inc > 0 ? impuesto : 0,
    total_linea,
  };
}

function totalizar(lineas) {
  const suma = (campo) => lineas.reduce((acc, l) => acc + l[campo], 0);
  const total_iva = suma("valor_iva");
  const total_inc = suma("valor_inc");
  return {
    subtotal: suma("base_linea"),
    total_iva,
    total_inc,
    total_impuestos: total_iva + total_inc,
    total: suma("total_linea"),
  };
}

module.exports = { TIPOS_CONSUMO, calcularLinea, totalizar };
