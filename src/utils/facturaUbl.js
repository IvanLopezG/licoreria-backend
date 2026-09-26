const crypto = require("crypto");
const { create } = require("xmlbuilder2");
const { ADQUIRIENTE_CONSUMIDOR_FINAL, CODIGO_AMBIENTE, fechaHoraColombia } = require("./cufe");

// XML UBL 2.1 de la factura electrónica de venta, con la estructura del Anexo
// Técnico de la Resolución DIAN 000165 de 2023.
//
// Es la BASE del documento, no un documento listo para la DIAN:
// - Falta la firma XAdES-EPES (segundo ext:UBLExtension, vacío), que exige el
//   certificado digital del dueño.
// - SoftwareID y PIN los asigna la DIAN al habilitar el software; se leen de
//   DIAN_SOFTWARE_ID y DIAN_SOFTWARE_PIN (.env), nunca de la base de datos.
// - No se valida contra el XSD oficial.
// Con un proveedor tecnológico, el XML válido es el que arma y firma el
// proveedor; este sirve para "software propio" y como material de consulta.

const PENDIENTE = "(pendiente)";
const DIAN = { schemeAgencyID: "195", schemeAgencyName: "CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" };
const NIT_DIAN = "800197268";

const NAMESPACES = {
  xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  "xmlns:ds": "http://www.w3.org/2000/09/xmldsig#",
  "xmlns:ext": "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  "xmlns:sts": "dian:gov:co:facturaelectronica:Structures-2-1",
  "xmlns:xades": "http://uri.etsi.org/01903/v1.3.2#",
  "xmlns:xades141": "http://uri.etsi.org/01903/v1.4.1#",
  "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "xsi:schemaLocation":
    "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 http://docs.oasis-open.org/ubl/os-UBL-2.1/xsd/maindoc/UBL-Invoice-2.1.xsd",
};

// Tipo de documento de identificación (tabla 13.2.1 del anexo).
const TIPO_DOCUMENTO = { CC: "13", NIT: "31", CE: "22", PP: "41" };

// Medio de pago (tabla 13.3.4.2). ID 1 = contado.
const MEDIO_PAGO = { efectivo: "10", tarjeta_credito: "48", tarjeta_debito: "49", transferencia: "47" };

// Códigos DANE de los municipios cercanos al negocio. Uno que no esté aquí
// queda como "(pendiente)" en el XML hasta agregarlo.
const MUNICIPIOS_DANE = { floridablanca: "68276", bucaramanga: "68001", "girón": "68307", giron: "68307", piedecuesta: "68547" };
const DEPARTAMENTOS_DANE = { santander: "68" };

const TRIBUTOS = {
  iva: { id: "01", nombre: "IVA" },
  inc: { id: "04", nombre: "INC" },
};

const valor = (n) => Number(n).toFixed(2);
const soloDigitos = (texto) => String(texto ?? "").replace(/\D/g, "");
const COP = { currencyID: "COP" };

// Tributo del emisor según de qué impuestos es responsable (tabla 13.2.6.2).
function tributoEmisor(emisor) {
  if (emisor.responsable_iva && emisor.responsable_inc) return { id: "ZA", nombre: "IVA e INC" };
  if (emisor.responsable_iva) return TRIBUTOS.iva;
  if (emisor.responsable_inc) return TRIBUTOS.inc;
  return { id: "ZZ", nombre: "No aplica" };
}

// Responsabilidad fiscal (tabla 13.2.6.1). Simplificación: solo distingue
// Régimen Simple (O-47); el resto queda como "No aplica - Otros" (R-99-PN).
// Si el negocio es gran contribuyente, autorretenedor, etc., hay que ajustarlo.
function responsabilidadFiscal(regimen) {
  return /simple/i.test(regimen || "") ? "O-47" : "R-99-PN";
}

function direccion(nodo, { municipio, departamento, linea }) {
  const municipioDane = MUNICIPIOS_DANE[(municipio || "").trim().toLowerCase()] || PENDIENTE;
  const departamentoDane = DEPARTAMENTOS_DANE[(departamento || "").trim().toLowerCase()] || PENDIENTE;
  nodo
    .ele("cbc:ID").txt(municipioDane).up()
    .ele("cbc:CityName").txt(municipio).up()
    .ele("cbc:CountrySubentity").txt(departamento).up()
    .ele("cbc:CountrySubentityCode").txt(departamentoDane).up()
    .ele("cac:AddressLine").ele("cbc:Line").txt(linea).up().up()
    .ele("cac:Country")
      .ele("cbc:IdentificationCode").txt("CO").up()
      .ele("cbc:Name", { languageID: "es" }).txt("Colombia").up()
    .up();
}

function parteEmisor(raiz, f, emisor) {
  const nit = { ...DIAN, schemeID: f.emisor_dv, schemeName: "31" };
  const tributo = tributoEmisor(emisor);
  const party = raiz
    .ele("cac:AccountingSupplierParty")
    .ele("cbc:AdditionalAccountID").txt(emisor.tipo_persona === "juridica" ? "1" : "2").up()
    .ele("cac:Party");
  party.ele("cac:PartyName").ele("cbc:Name").txt(f.emisor_razon_social);
  direccion(party.ele("cac:PhysicalLocation").ele("cac:Address"), {
    municipio: f.emisor_municipio,
    departamento: f.emisor_departamento,
    linea: f.emisor_direccion,
  });
  const impuestos = party.ele("cac:PartyTaxScheme");
  impuestos.ele("cbc:RegistrationName").txt(f.emisor_razon_social);
  impuestos.ele("cbc:CompanyID", nit).txt(f.emisor_nit);
  impuestos.ele("cbc:TaxLevelCode", { listName: "48" }).txt(responsabilidadFiscal(f.emisor_regimen));
  direccion(impuestos.ele("cac:RegistrationAddress"), {
    municipio: f.emisor_municipio,
    departamento: f.emisor_departamento,
    linea: f.emisor_direccion,
  });
  impuestos.ele("cac:TaxScheme").ele("cbc:ID").txt(tributo.id).up().ele("cbc:Name").txt(tributo.nombre);
  const legal = party.ele("cac:PartyLegalEntity");
  legal.ele("cbc:RegistrationName").txt(f.emisor_razon_social);
  legal.ele("cbc:CompanyID", nit).txt(f.emisor_nit);
  legal.ele("cac:CorporateRegistrationScheme").ele("cbc:ID").txt(f.prefijo || "");
  party.ele("cac:Contact").ele("cbc:ElectronicMail").txt(emisor.correo_electronico || PENDIENTE);
}

// Adquiriente: la ley solo exige nombre o razón social, NIT o cédula y correo.
// Sin identificación es Consumidor Final (222222222222, tipo 13).
function parteAdquiriente(raiz, f) {
  const identificado = Boolean(f.cliente_num_doc);
  const tipo = identificado ? TIPO_DOCUMENTO[f.cliente_tipo_doc] : "13";
  const numero = identificado ? soloDigitos(f.cliente_num_doc) || f.cliente_num_doc : ADQUIRIENTE_CONSUMIDOR_FINAL;
  const atributos = { ...DIAN, schemeName: tipo };
  if (tipo === "31" && f.cliente_dv) atributos.schemeID = f.cliente_dv;

  const party = raiz
    .ele("cac:AccountingCustomerParty")
    .ele("cbc:AdditionalAccountID").txt(tipo === "31" ? "1" : "2").up()
    .ele("cac:Party");
  const impuestos = party.ele("cac:PartyTaxScheme");
  impuestos.ele("cbc:RegistrationName").txt(f.cliente_nombre);
  impuestos.ele("cbc:CompanyID", atributos).txt(numero);
  impuestos.ele("cbc:TaxLevelCode", { listName: "48" }).txt("R-99-PN");
  impuestos.ele("cac:TaxScheme").ele("cbc:ID").txt("ZZ").up().ele("cbc:Name").txt("No aplica");
  const legal = party.ele("cac:PartyLegalEntity");
  legal.ele("cbc:RegistrationName").txt(f.cliente_nombre);
  legal.ele("cbc:CompanyID", atributos).txt(numero);
  if (f.cliente_correo) party.ele("cac:Contact").ele("cbc:ElectronicMail").txt(f.cliente_correo);
}

// Agrupa los impuestos por tributo y tarifa: un cac:TaxTotal por tributo, con
// un cac:TaxSubtotal por cada tarifa.
function impuestosPorTributo(items) {
  const tributos = new Map();
  for (const item of items) {
    for (const [clave, tasa, monto] of [
      ["iva", item.tasa_iva_bps, item.valor_iva],
      ["inc", item.tasa_inc_bps, item.valor_inc],
    ]) {
      if (tasa === 0) continue;
      const tarifas = tributos.get(clave) || new Map();
      const grupo = tarifas.get(tasa) || { base: 0, valor: 0 };
      grupo.base += item.base_linea;
      grupo.valor += monto;
      tarifas.set(tasa, grupo);
      tributos.set(clave, tarifas);
    }
  }
  return tributos;
}

function totalImpuesto(nodo, tributo, tarifas) {
  const totalTributo = [...tarifas.values()].reduce((acc, g) => acc + g.valor, 0);
  const taxTotal = nodo.ele("cac:TaxTotal");
  taxTotal.ele("cbc:TaxAmount", COP).txt(valor(totalTributo));
  for (const [tasa, grupo] of tarifas) {
    const sub = taxTotal.ele("cac:TaxSubtotal");
    sub.ele("cbc:TaxableAmount", COP).txt(valor(grupo.base));
    sub.ele("cbc:TaxAmount", COP).txt(valor(grupo.valor));
    sub.ele("cac:TaxCategory")
      .ele("cbc:Percent").txt(valor(tasa / 100)).up()
      .ele("cac:TaxScheme").ele("cbc:ID").txt(tributo.id).up().ele("cbc:Name").txt(tributo.nombre);
  }
}

// SoftwareSecurityCode = SHA-384(SoftwareID + PIN + NumFac).
function codigoSeguridadSoftware(numeroCompleto) {
  const { DIAN_SOFTWARE_ID, DIAN_SOFTWARE_PIN } = process.env;
  if (!DIAN_SOFTWARE_ID || !DIAN_SOFTWARE_PIN) return PENDIENTE;
  return crypto.createHash("sha384").update(DIAN_SOFTWARE_ID + DIAN_SOFTWARE_PIN + numeroCompleto, "utf8").digest("hex");
}

function extensionesDian(raiz, f, { qr_url }) {
  const extensiones = raiz.ele("ext:UBLExtensions");
  const dian = extensiones.ele("ext:UBLExtension").ele("ext:ExtensionContent").ele("sts:DianExtensions");

  const control = dian.ele("sts:InvoiceControl");
  control.ele("sts:InvoiceAuthorization").txt(f.resolucion_numero || PENDIENTE);
  control.ele("sts:AuthorizationPeriod")
    .ele("cbc:StartDate").txt(f.resolucion_fecha || PENDIENTE).up()
    .ele("cbc:EndDate").txt(f.vigencia_hasta || PENDIENTE);
  const autorizadas = control.ele("sts:AuthorizedInvoices");
  if (f.prefijo) autorizadas.ele("sts:Prefix").txt(f.prefijo);
  autorizadas.ele("sts:From").txt(String(f.rango_desde)).up().ele("sts:To").txt(String(f.rango_hasta ?? PENDIENTE));

  dian.ele("sts:InvoiceSource").ele("cbc:IdentificationCode", {
    listAgencyID: "6",
    listAgencyName: "United Nations Economic Commission for Europe",
    listSchemeURI: "urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1",
  }).txt("CO");

  const proveedor = dian.ele("sts:SoftwareProvider");
  proveedor.ele("sts:ProviderID", { ...DIAN, schemeID: f.emisor_dv, schemeName: "31" }).txt(f.emisor_nit);
  proveedor.ele("sts:SoftwareID", DIAN).txt(process.env.DIAN_SOFTWARE_ID || PENDIENTE);
  dian.ele("sts:SoftwareSecurityCode", DIAN).txt(codigoSeguridadSoftware(f.numero_completo));
  dian.ele("sts:AuthorizationProvider")
    .ele("sts:AuthorizationProviderID", { ...DIAN, schemeID: "4", schemeName: "31" }).txt(NIT_DIAN);
  dian.ele("sts:QRCode").txt(qr_url);

  // Aquí va la firma digital XAdES-EPES (ds:Signature) cuando exista certificado.
  extensiones.ele("ext:UBLExtension").ele("ext:ExtensionContent");
}

// f: factura completa (facturaModel.buscarPorId, con items y datos de la
// secuencia). emisor: fila actual del emisor (tipo de persona, correo,
// responsabilidades). doc: { cufe, qr_url, ambiente, vigencia_hasta }.
function generarXmlFactura(f, emisor, doc) {
  const { fecha, hora } = fechaHoraColombia(f.fecha_expedicion);
  const raiz = create({ version: "1.0", encoding: "UTF-8", standalone: false }).ele("Invoice", NAMESPACES);

  extensionesDian(raiz, { ...f, vigencia_hasta: doc.vigencia_hasta }, doc);

  raiz.ele("cbc:UBLVersionID").txt("UBL 2.1");
  raiz.ele("cbc:CustomizationID").txt("10"); // Tipo de operación: estándar
  raiz.ele("cbc:ProfileID").txt("DIAN 2.1: Factura Electrónica de Venta");
  raiz.ele("cbc:ProfileExecutionID").txt(CODIGO_AMBIENTE[doc.ambiente]);
  raiz.ele("cbc:ID").txt(f.numero_completo);
  raiz.ele("cbc:UUID", { schemeID: CODIGO_AMBIENTE[doc.ambiente], schemeName: "CUFE-SHA384" }).txt(doc.cufe);
  raiz.ele("cbc:IssueDate").txt(fecha);
  raiz.ele("cbc:IssueTime").txt(hora);
  raiz.ele("cbc:InvoiceTypeCode").txt("01"); // Factura electrónica de venta
  raiz.ele("cbc:Note").txt("Documento generado localmente, pendiente de transmisión y validación ante la DIAN.");
  raiz.ele("cbc:DocumentCurrencyCode").txt("COP");
  raiz.ele("cbc:LineCountNumeric").txt(String(f.items.length));

  parteEmisor(raiz, f, emisor);
  parteAdquiriente(raiz, f);

  raiz.ele("cac:PaymentMeans")
    .ele("cbc:ID").txt("1").up()
    .ele("cbc:PaymentMeansCode").txt(MEDIO_PAGO[f.forma_pago] || "ZZZ");

  for (const [clave, tarifas] of impuestosPorTributo(f.items)) {
    totalImpuesto(raiz, TRIBUTOS[clave], tarifas);
  }

  raiz.ele("cac:LegalMonetaryTotal")
    .ele("cbc:LineExtensionAmount", COP).txt(valor(f.subtotal)).up()
    .ele("cbc:TaxExclusiveAmount", COP).txt(valor(f.subtotal)).up()
    .ele("cbc:TaxInclusiveAmount", COP).txt(valor(f.total)).up()
    .ele("cbc:PayableAmount", COP).txt(valor(f.total));

  f.items.forEach((item, i) => {
    const linea = raiz.ele("cac:InvoiceLine");
    linea.ele("cbc:ID").txt(String(i + 1));
    linea.ele("cbc:InvoicedQuantity", { unitCode: "94" }).txt(String(item.cantidad)); // 94 = unidad
    linea.ele("cbc:LineExtensionAmount", COP).txt(valor(item.base_linea));
    const impuestosLinea = impuestosPorTributo([item]);
    for (const [clave, tarifas] of impuestosLinea) totalImpuesto(linea, TRIBUTOS[clave], tarifas);
    const producto = linea.ele("cac:Item");
    producto.ele("cbc:Description").txt(item.descripcion);
    producto.ele("cac:StandardItemIdentification").ele("cbc:ID", { schemeID: "999" }).txt(String(item.id_producto));
    // Precio de 1 unidad sin impuestos (la base de la línea repartida por unidad).
    linea.ele("cac:Price")
      .ele("cbc:PriceAmount", COP).txt(valor(item.base_linea / item.cantidad)).up()
      .ele("cbc:BaseQuantity", { unitCode: "94" }).txt("1");
  });

  return raiz.end({ prettyPrint: true });
}

module.exports = { generarXmlFactura };
