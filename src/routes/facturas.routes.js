const express = require("express");
const facturaController = require("../controllers/facturaController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

// Quien cobra (cajero/administrador) consulta y reimprime facturas.
router.use(auth);

const gestion = requireRole("administrador", "cajero");

// Filtrable por ?desde= y ?hasta= (yyyy-MM-dd, contra fecha_expedicion en UTC).
router.get("/", gestion, facturaController.listar);
router.get("/:id", gestion, facturaController.obtener);
router.get("/:id/pdf", gestion, facturaController.pdf);
// Solo facturas emitidas en modo electrónico: XML UBL 2.1 (sin firmar) y
// transmisión a la DIAN vía proveedor tecnológico (aún no conectada: 501).
router.get("/:id/xml", gestion, facturaController.xml);
router.post("/:id/transmitir", requireRole("administrador"), facturaController.transmitir);
// Solo el administrador anula: separa a quien cobra de quien puede revertir
// un cobro (control interno). Body: { motivo (>= 10 caracteres), reabrir_pedidos? }.
router.post("/:id/anular", requireRole("administrador"), facturaController.anular);

module.exports = router;
