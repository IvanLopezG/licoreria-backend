const express = require("express");
const alertaStockController = require("../controllers/alertaStockController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

// Mismos roles que inventario y reportes.
router.use(auth, requireRole("administrador", "cajero"));

// Productos agotados, bajo el mínimo o por agotarse, con la cantidad sugerida a pedir.
router.get("/", alertaStockController.listar);

module.exports = router;
