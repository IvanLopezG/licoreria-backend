const express = require("express");
const usuarioController = require("../controllers/usuarioController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth);
router.post("/", requireRole("administrador"), usuarioController.crear);
router.get("/", requireRole("administrador"), usuarioController.listar);

module.exports = router;
