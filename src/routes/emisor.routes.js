const express = require("express");
const facturaController = require("../controllers/facturaController");
const resolucionController = require("../controllers/resolucionController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth);

// Datos del negocio que aparecen en el encabezado y pie de cada factura.
router.get("/", requireRole("administrador", "cajero"), facturaController.obtenerEmisor);
router.put("/", requireRole("administrador"), facturaController.editarEmisor);

// Resolución de numeración: solo administrador (configuración fiscal). GET
// nunca devuelve la clave técnica; PUT edita la activa si aún no emitió
// facturas; POST registra una nueva y deja la anterior como histórica.
const soloAdmin = requireRole("administrador");
router.get("/resolucion", soloAdmin, resolucionController.obtener);
router.put("/resolucion", soloAdmin, resolucionController.actualizar);
router.post("/resolucion", soloAdmin, resolucionController.registrar);

module.exports = router;
