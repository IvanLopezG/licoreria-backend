const express = require("express");
const pedidoController = require("../controllers/pedidoController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");

const router = express.Router();

router.use(auth, requireRole("administrador", "mesero", "cajero"));

// RF-13: panel de pedidos entrantes, filtrable por ?estado= y ?id_mesa=.
router.get("/", pedidoController.listar);
router.put("/:id/entregado", pedidoController.entregado);
// Cancelar un pedido (borrarlo) es tarea de administrador/cajero, no del
// mesero, igual que cobrar; deja destrabar una mesa cuyo cierre de cuenta
// no puede completarse por un pedido con datos inválidos.
router.delete("/:id", requireRole("administrador", "cajero"), pedidoController.cancelar);

module.exports = router;
