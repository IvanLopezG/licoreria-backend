const express = require("express");
const catalogoController = require("../controllers/catalogoController");

const router = express.Router();

// RF-11: catálogo público sin login, identificado por el token de la mesa.
router.get("/:token", catalogoController.obtener);

module.exports = router;
