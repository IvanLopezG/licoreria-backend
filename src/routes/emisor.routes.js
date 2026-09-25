const express = require("express");
const facturaController = require("../controllers/facturaController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth);

// Datos del negocio que aparecen en el encabezado y pie de cada factura.
router.get("/", requireRole("administrador", "cajero"), facturaController.obtenerEmisor);
router.put("/", requireRole("administrador"), facturaController.editarEmisor);

module.exports = router;
