const express = require("express");
const movimientoController = require("../controllers/movimientoInventarioController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth, requireRole("administrador", "cajero"));

// RF-06 / RF-07 / RF-09: entradas, salidas e historial de movimientos.
router.post("/entradas", movimientoController.entrada);
router.post("/salidas", movimientoController.salida);
router.get("/movimientos", movimientoController.historial);

module.exports = router;
