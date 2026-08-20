const express = require("express");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

// Placeholder de Sprint 2 (Modulo de Inventario, RF-04 a RF-09).
// Sirve aqui solo para demostrar que un mesero NO puede entrar
// a funciones de administracion de inventario (US-02).
router.get("/ping", auth, requireRole("administrador", "cajero"), (req, res) => {
  res.json({ mensaje: `Acceso concedido a inventario para ${req.usuario.rol}.` });
});

module.exports = router;
