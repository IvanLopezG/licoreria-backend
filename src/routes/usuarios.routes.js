const express = require("express");
const usuarioController = require("../controllers/usuarioController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth);
router.post("/", requireRole("administrador"), usuarioController.crear);
router.get("/", requireRole("administrador"), usuarioController.listar);
// Sin DELETE: un usuario con ventas, movimientos o bitácora no se puede borrar
// (claves foráneas); se desactiva con activo = 0.
router.put("/:id", requireRole("administrador"), usuarioController.editar);

module.exports = router;
