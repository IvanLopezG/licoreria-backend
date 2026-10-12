// Cliente mínimo de la API REST de Gemini (generateContent), con fetch nativo y
// sin dependencias. Una llamada = una petición HTTP con su propio timeout.
//
// - La clave (GEMINI_API_KEY) va en el encabezado x-goog-api-key, nunca en la URL:
//   así no puede quedar en un log de URL ni en el mensaje de un error de red.
// - Nunca se registra ni se devuelve la clave. Los errores son ErrorGemini con un
//   "motivo" corto y fijo (sin_clave, timeout, red, http_<código>,
//   respuesta_invalida), que es lo único que el chatbot registra.
// - Las pruebas reemplazan dependencias.fetch y dependencias.timeoutMs: nunca se
//   llama al Gemini real.

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELO_POR_DEFECTO = "gemini-3.8-flash";
const TIMEOUT_MS = 20000;

class ErrorGemini extends Error {
  constructor(motivo) {
    super(`Gemini no disponible: ${motivo}`);
    this.name = "ErrorGemini";
    this.motivo = motivo;
  }
}

const dependencias = {
  fetch: (...args) => globalThis.fetch(...args),
  timeoutMs: TIMEOUT_MS,
};

function configuracion() {
  const clave = (process.env.GEMINI_API_KEY || "").trim();
  const modelo = (process.env.GEMINI_MODEL || "").trim() || MODELO_POR_DEFECTO;
  return { clave, modelo };
}

function disponible() {
  return configuracion().clave !== "";
}

// Envía el cuerpo de generateContent y devuelve candidates[0].content
// ({ role, parts: [...] }) tal cual, para poder devolverlo en la conversación
// (los modelos Gemini 3 exigen recibir de vuelta sus thoughtSignature).
async function generar(cuerpo) {
  const { clave, modelo } = configuracion();
  if (!clave) throw new ErrorGemini("sin_clave");
  if (!/^[\w.-]+$/.test(modelo)) throw new ErrorGemini("modelo_invalido");

  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), dependencias.timeoutMs);
  try {
    let respuesta;
    try {
      respuesta = await dependencias.fetch(`${URL_BASE}/${modelo}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
        body: JSON.stringify(cuerpo),
        signal: control.signal,
      });
    } catch {
      throw new ErrorGemini(control.signal.aborted ? "timeout" : "red");
    }
    if (!respuesta || !respuesta.ok) {
      throw new ErrorGemini(`http_${respuesta ? respuesta.status : "sin_respuesta"}`);
    }
    let datos;
    try {
      datos = await respuesta.json();
    } catch {
      throw new ErrorGemini(control.signal.aborted ? "timeout" : "respuesta_invalida");
    }
    const contenido = datos && Array.isArray(datos.candidates) && datos.candidates[0] && datos.candidates[0].content;
    if (!contenido || !Array.isArray(contenido.parts) || contenido.parts.length === 0) {
      throw new ErrorGemini("respuesta_invalida");
    }
    return contenido;
  } finally {
    clearTimeout(temporizador);
  }
}

module.exports = { generar, disponible, configuracion, dependencias, ErrorGemini, MODELO_POR_DEFECTO, TIMEOUT_MS };
