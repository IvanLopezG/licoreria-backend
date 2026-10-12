const express = require("express");
const chatbotController = require("../controllers/chatbotController");
const auth = require("../middlewares/auth");
const requireRole = require("../middlewares/roles");
const limiteIntentos = require("../middlewares/limiteIntentos");

const router = express.Router();

// Mismos roles que reportes y alertas de stock: el chatbot solo lee esos datos.
router.use(auth, requireRole("administrador", "cajero"));

// 20 mensajes por minuto por usuario (en memoria, por instancia).
const limiteMensajes = limiteIntentos({
  ventanaMs: 60 * 1000,
  maximo: 20,
  clave: (req) => `usuario:${req.usuario.id_usuario}`,
  mensaje: "Demasiados mensajes al asistente. Espera un minuto e inténtalo de nuevo.",
});

router.get("/preguntas", chatbotController.preguntas);
router.post("/", limiteMensajes, chatbotController.responder);

module.exports = router;
