const express = require("express");
const ventaController = require("../controllers/ventaController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

// Cobrar (con o sin mesa) es tarea de cajero/administrador, igual que el
// cierre de cuenta por mesa; el mesero no maneja caja.
router.use(auth, requireRole("administrador", "cajero"));

// RF-15: venta rápida sin mesa.
router.post("/", ventaController.crearMostrador);

module.exports = router;
