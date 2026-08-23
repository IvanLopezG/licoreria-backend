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
// El QR es información de gestión de mesas (igual que crearlas): administrador y cajero, no mesero.
router.get("/:id/qr", requireRole("administrador", "cajero"), mesaController.qr);
// RF-14: solo quien cobra (cajero/administrador) cierra la cuenta de una mesa.
router.post("/:id/cerrar-cuenta", requireRole("administrador", "cajero"), mesaController.cerrarCuenta);

module.exports = router;
