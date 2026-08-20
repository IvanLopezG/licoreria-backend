const express = require("express");
const auditoriaController = require("../controllers/auditoriaController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.get("/", auth, requireRole("administrador"), auditoriaController.listar);

module.exports = router;
