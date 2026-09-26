const express = require("express");
const proveedorController = require("../controllers/proveedorController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth, requireRole("administrador", "cajero"));

router.post("/", proveedorController.crear);
router.get("/", proveedorController.listar);
router.get("/:id", proveedorController.obtener);
// Edición parcial: los campos que no se envían se conservan.
router.put("/:id", proveedorController.editar);
router.post("/:id/productos", proveedorController.asociarProducto);
// Quita la asociación (no borra el producto ni el proveedor).
router.delete("/:id/productos/:id_producto", proveedorController.quitarProducto);

module.exports = router;
