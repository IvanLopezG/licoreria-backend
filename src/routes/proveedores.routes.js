const express = require("express");
const proveedorController = require("../controllers/proveedorController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth, requireRole("administrador", "cajero"));

router.post("/", proveedorController.crear);
router.get("/", proveedorController.listar);
router.get("/:id", proveedorController.obtener);
router.post("/:id/productos", proveedorController.asociarProducto);

module.exports = router;
