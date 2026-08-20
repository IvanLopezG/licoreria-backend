const express = require("express");
const categoriaController = require("../controllers/categoriaController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth);
router.post("/", requireRole("administrador", "cajero"), categoriaController.crear);
router.get("/", requireRole("administrador", "cajero"), categoriaController.listar);

module.exports = router;
