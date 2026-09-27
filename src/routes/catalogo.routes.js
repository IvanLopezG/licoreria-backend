const express = require("express");
const catalogoController = require("../controllers/catalogoController");
const limiteIntentos = require("../middlewares/limiteIntentos");

const router = express.Router();

// Tokens inválidos (de mesa o de sesión): 30 fallos por IP cada 10 minutos.
// El uso normal no cuenta. Aparte, límites generosos por IP (en un local los
// celulares suelen compartir la IP del wifi).
router.use(limiteIntentos({ ventanaMs: 10 * 60 * 1000, maximo: 30, soloFallos: true }));
const limitePedidos = limiteIntentos({ ventanaMs: 5 * 60 * 1000, maximo: 60 });
const limiteSesion = limiteIntentos({ ventanaMs: 60 * 1000, maximo: 300 });

// Vista del cliente de su propia sesión (pedidos y factura), autenticada con
// el encabezado X-Sesion-Token que recibió al pedir. Van antes de "/:token".
router.get("/sesion/estado", limiteSesion, catalogoController.estadoSesion);
router.get("/sesion/factura.pdf", limiteSesion, catalogoController.pdfSesion);
router.post("/sesion/listo", limiteSesion, catalogoController.listoSesion);

// RF-11: catálogo público sin login, identificado por el token de la mesa.
router.get("/:token", catalogoController.obtener);
// RF-12: autopedido del cliente, sin login, asociado a la mesa del QR escaneado.
// La respuesta trae token_sesion la primera vez que ese celular pide en la sesión.
router.post("/:token/pedidos", limitePedidos, catalogoController.crearPedido);
// Pedidos abiertos de la mesa: solo con X-Sesion-Token de la sesión activa
// de esa mesa; sin él, [] (el QR solo no da acceso a la cuenta).
router.get("/:token/pedidos", catalogoController.listarPedidos);

module.exports = router;
