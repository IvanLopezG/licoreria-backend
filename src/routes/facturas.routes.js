const express = require("express");
const facturaController = require("../controllers/facturaController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

// Quien cobra (cajero/administrador) consulta y reimprime facturas.
router.use(auth, requireRole("administrador", "cajero"));

// Filtrable por ?desde= y ?hasta= (yyyy-MM-dd, contra fecha_expedicion en UTC).
router.get("/", facturaController.listar);
router.get("/:id", facturaController.obtener);
router.get("/:id/pdf", facturaController.pdf);

module.exports = router;
