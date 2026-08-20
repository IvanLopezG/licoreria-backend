const express = require("express");
const movimientoController = require("../controllers/movimientoInventarioController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth, requireRole("administrador", "cajero"));

// RF-06: entradas de inventario.
router.post("/entradas", movimientoController.entrada);

module.exports = router;
