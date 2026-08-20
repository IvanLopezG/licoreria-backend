const express = require("express");
const productoController = require("../controllers/productoController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth, requireRole("administrador", "cajero"));

router.post("/", productoController.crear);
router.get("/", productoController.listar);
router.get("/:id", productoController.obtener);
router.put("/:id", productoController.editar);

module.exports = router;
