const catalogoService = require("../services/catalogoService");
const clienteSesionService = require("../services/clienteSesionService");
const { generarPdfFactura } = require("../utils/facturaPdf");

// El token de sesión del cliente solo se acepta en este encabezado, nunca en
// la URL (no queda en historiales, logs de proxies ni en el Referer).
const tokenSesion = (req) => req.get("X-Sesion-Token") || undefined;

async function obtener(req, res) {
  try {
    return res.json(await catalogoService.obtenerCatalogo(req.params.token));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function crearPedido(req, res) {
  try {
    const pedido = await catalogoService.crearPedido(req.params.token, req.body.items, tokenSesion(req));
    res.setHeader("Cache-Control", "no-store");
    return res.status(201).json(pedido);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function listarPedidos(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await catalogoService.listarPedidos(req.params.token, tokenSesion(req)));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

// Polling del cliente: If-None-Match con la revisión → 304 sin cuerpo y sin
// más consultas que la del token.
async function estadoSesion(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const sesion = await clienteSesionService.autenticar(tokenSesion(req));
    const etag = clienteSesionService.etagDe(sesion);
    res.setHeader("ETag", etag);
    if (req.get("If-None-Match") === etag) return res.status(304).end();
    return res.json(await clienteSesionService.estado(sesion));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}

async function pdfSesion(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const sesion = await clienteSesionService.autenticar(tokenSesion(req));
    const factura = await clienteSesionService.facturaParaPdf(sesion);
    const buffer = await generarPdfFactura(factura);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=factura_${factura.numero_completo}.pdf`);
    return res.send(buffer);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}

async function listoSesion(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    return res.json(await clienteSesionService.listo(tokenSesion(req)));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = { obtener, crearPedido, listarPedidos, estadoSesion, pdfSesion, listoSesion };
