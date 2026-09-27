const facturaService = require("../services/facturaService");
const { generarPdfFactura } = require("../utils/facturaPdf");

// Las facturas se emiten solas al cobrar (cierre de mesa o venta de
// mostrador); aquí solo se consultan, se descargan y se configura el emisor.

async function listar(req, res) {
  const { desde, hasta } = req.query;
  return res.json(await facturaService.listarFacturas({ desde, hasta }));
}

async function obtener(req, res) {
  return res.json(await facturaService.obtenerFactura(Number(req.params.id)));
}

async function pdf(req, res) {
  const factura = await facturaService.obtenerFactura(Number(req.params.id));
  const buffer = await generarPdfFactura(factura);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=factura_${factura.numero_completo}.pdf`);
  return res.send(buffer);
}

async function xml(req, res) {
  const { numero_completo, xml: contenido } = await facturaService.obtenerXml(Number(req.params.id));
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename=factura_${numero_completo}.xml`);
  return res.send(contenido);
}

async function transmitir(req, res) {
  return res.json(await facturaService.transmitirFactura(Number(req.params.id)));
}

async function anular(req, res) {
  const factura = await facturaService.anularFactura(Number(req.params.id), req.body || {}, req.usuario.id_usuario);

  // El middleware de auditoría escribe el registro al ver este campo.
  req.auditoria = { accion: "editar", entidad: "facturas", id_entidad: factura.id_factura };

  return res.json(factura);
}

async function obtenerEmisor(req, res) {
  return res.json(await facturaService.obtenerEmisor());
}

async function editarEmisor(req, res) {
  const emisor = await facturaService.editarEmisor(req.body || {});

  // El middleware de auditoría escribe el registro al ver este campo.
  req.auditoria = { accion: "editar", entidad: "emisor", id_entidad: emisor.id };

  return res.json(emisor);
}

module.exports = { listar, obtener, pdf, xml, transmitir, anular, obtenerEmisor, editarEmisor };
