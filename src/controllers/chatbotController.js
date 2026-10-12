const chatbotService = require("../services/chatbotService");

// POST /api/chatbot  { mensaje } | { pregunta_id }  →  { respuesta, origen: "ia" | "basico" }
// Solo el cuerpo llega al servicio: nunca datos del usuario autenticado.
async function responder(req, res) {
  const { mensaje, pregunta_id } = req.body;
  return res.json(await chatbotService.responder({ mensaje, pregunta_id }));
}

// GET /api/chatbot/preguntas  →  { preguntas: [{ id, texto }] }
function preguntas(req, res) {
  return res.json({ preguntas: chatbotService.preguntas() });
}

module.exports = { responder, preguntas };
