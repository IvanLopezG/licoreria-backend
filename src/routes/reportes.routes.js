const express = require("express");
const reporteController = require("../controllers/reporteController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

// Mismos roles que los reportes de ventas y de movimientos (RF-17/RF-18).
router.use(auth, requireRole("administrador", "cajero"));

// Reporte por periodo: ventas, productos más y menos vendidos y movimientos.
router.get("/", reporteController.porPeriodo);

module.exports = router;
