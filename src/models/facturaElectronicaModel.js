const db = require("../db/db");
const { calcularCufe, fechaHoraColombia, urlVerificacion } = require("../utils/cufe");
const { generarXmlFactura } = require("../utils/facturaUbl");

// Clave técnica de relleno para el ambiente de pruebas mientras la secuencia
// no tenga la real. En producción es obligatoria (ver facturaService.editarEmisor).
const CLAVE_TECNICA_PENDIENTE = "clave-tecnica-pendiente";

function errorFacturacion(mensaje) {
  const err = new Error(mensaje);
  err.status = 500;
  return err;
}

// Genera CUFE, URL del QR y XML UBL de una factura recién insertada y los
// guarda como pendientes de transmisión. NO abre transacción: recibe el cx de
// la venta (ver facturaModel.emitir), así factura y documento son atómicos.
async function generar(factura, emisor, cx) {
  const secuencia = await cx.uno(
    "SELECT clave_tecnica, vigencia_hasta FROM secuencias_factura WHERE id_secuencia = $1",
    [factura.id_secuencia]
  );
  const ambiente = emisor.ambiente_dian;
  const clave_tecnica = secuencia.clave_tecnica || (ambiente === "pruebas" ? CLAVE_TECNICA_PENDIENTE : null);
  if (!clave_tecnica) throw errorFacturacion("La secuencia de facturación activa no tiene clave técnica de la DIAN.");

  const { fecha, hora } = fechaHoraColombia(factura.fecha_expedicion);
  const cufe = calcularCufe({
    numero_completo: factura.numero_completo,
    fecha,
    hora,
    subtotal: factura.subtotal,
    total_iva: factura.total_iva,
    total_inc: factura.total_inc,
    total: factura.total,
    nit_emisor: factura.emisor_nit,
    num_adquiriente: factura.cliente_num_doc,
    clave_tecnica,
    ambiente,
  });
  const qr_url = urlVerificacion(cufe, ambiente);
  const xml_ubl = generarXmlFactura(factura, emisor, { cufe, qr_url, ambiente, vigencia_hasta: secuencia.vigencia_hasta });

  await cx.ejecutar(
    `INSERT INTO facturas_electronicas (id_factura, cufe, ambiente_dian, qr_url, xml_ubl, proveedor_tecnologico)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [factura.id_factura, cufe, ambiente, qr_url, xml_ubl, emisor.proveedor_tecnologico]
  );
}

// Datos del documento electrónico sin el XML (que puede ser pesado); el XML
// se descarga aparte con obtenerXml.
function buscarPorFactura(id_factura, cx = db) {
  return cx.uno(
    `SELECT cufe, ambiente_dian, qr_url, proveedor_tecnologico, estado_transmision,
            mensaje_transmision, fecha_generacion, fecha_transmision
     FROM facturas_electronicas WHERE id_factura = $1`,
    [id_factura]
  );
}

async function obtenerXml(id_factura) {
  const fila = await db.uno("SELECT xml_ubl FROM facturas_electronicas WHERE id_factura = $1", [id_factura]);
  return fila ? fila.xml_ubl : null;
}

module.exports = { generar, buscarPorFactura, obtenerXml };
