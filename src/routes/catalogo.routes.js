const express = require("express");
const catalogoController = require("../controllers/catalogoController");

const router = express.Router();

// RF-11: catálogo público sin login, identificado por el token de la mesa.
router.get("/:token", catalogoController.obtener);
// RF-12: autopedido del cliente, sin login, asociado a la mesa del QR escaneado.
router.post("/:token/pedidos", catalogoController.crearPedido);
// Historial de pedidos abiertos de esa mesa (para que el cliente vea "su
// pedido hasta ahora" aunque recargue), sin exponer datos de otras mesas.
router.get("/:token/pedidos", catalogoController.listarPedidos);

module.exports = router;
