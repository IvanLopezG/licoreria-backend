const express = require("express");
const mesaController = require("../controllers/mesaController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth);

// RF-10: solo el administrador crea mesas; el resto del personal solo consulta.
router.post("/", requireRole("administrador"), mesaController.crear);
router.get("/", requireRole("administrador", "mesero", "cajero"), mesaController.listar);
router.get("/:id", requireRole("administrador", "mesero", "cajero"), mesaController.obtener);
router.get("/:id/qr", requireRole("administrador", "mesero", "cajero"), mesaController.qr);

module.exports = router;
