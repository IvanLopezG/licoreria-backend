const facturaService = require("../services/facturaService");
const { generarPdfFactura } = require("../utils/facturaPdf");

// Las facturas se emiten solas al cobrar (cierre de mesa o venta de
// mostrador); aquí solo se consultan, se descargan y se configura el emisor.

function listar(req, res) {
  const { desde, hasta } = req.query;
  return res.json(facturaService.listarFacturas({ desde, hasta }));
}

function obtener(req, res) {
  try {
    return res.json(facturaService.obtenerFactura(Number(req.params.id)));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function pdf(req, res) {
  try {
    const factura = facturaService.obtenerFactura(Number(req.params.id));
    const buffer = await generarPdfFactura(factura);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=factura_${factura.numero_completo}.pdf`);
    return res.send(buffer);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}

function obtenerEmisor(req, res) {
  return res.json(facturaService.obtenerEmisor());
}

function editarEmisor(req, res) {
  try {
    const emisor = facturaService.editarEmisor(req.body || {});

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "editar", entidad: "emisor", id_entidad: emisor.id };

    return res.json(emisor);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

module.exports = { listar, obtener, pdf, obtenerEmisor, editarEmisor };
