const { ErrorApp, ErrorNoEncontrado } = require("../utils/errores");

// Manejador central de errores: el único lugar donde un error se convierte en
// respuesta HTTP. La forma es siempre { error: mensaje }, la que leen el panel
// web (api.js), la app Android (ErrorResponse) y el catálogo.
//
// - ErrorApp: su status y su mensaje, tal cual (los decidió el negocio).
// - Errores de express.json() (body-parser): conservan su código, mensaje en español.
// - Cualquier otro error (pg, un bug): 500 con mensaje genérico; nunca el texto
//   de la excepción ni el stack.
// - Rutas públicas del catálogo (/api/catalogo): los 500 siempre con mensaje
//   genérico, aunque sean ErrorInterno; los 4xx de negocio se muestran igual.

const MENSAJE_500 = "Ocurrió un error inesperado en el servidor. Inténtalo de nuevo en un momento.";
const MENSAJE_500_PUBLICO = "Ocurrió un error, intenta de nuevo.";

const MENSAJES_BODY_PARSER = {
  "entity.parse.failed": "El cuerpo de la petición no es un JSON válido.",
  "entity.too.large": "El cuerpo de la petición es demasiado grande.",
};

const esRutaPublica = (req) => /^\/api\/catalogo(\/|$|\?)/.test(req.originalUrl || "");

// { status, mensaje, esperado } — esperado: el negocio decidió el código y el mensaje.
function clasificar(err) {
  if (err instanceof ErrorApp) return { status: err.status, mensaje: err.message, esperado: true };
  const status = Number(err && (err.status || err.statusCode));
  if (err && typeof err.type === "string" && status >= 400 && status < 500) {
    return { status, mensaje: MENSAJES_BODY_PARSER[err.type] || "La petición no es válida.", esperado: true };
  }
  // Transición: errores con status numérico del patrón anterior (err.status = N)
  // mientras se migran los servicios a ErrorApp. Se quita al terminar la migración.
  if (status >= 400 && status < 600 && typeof (err && err.message) === "string") {
    return { status, mensaje: err.message, esperado: true };
  }
  return { status: 500, mensaje: MENSAJE_500, esperado: false };
}

// eslint-disable-next-line no-unused-vars -- Express reconoce el manejador por sus 4 argumentos.
function manejoErrores(err, req, res, next) {
  if (res.headersSent) return next(err);

  const { status, mensaje } = clasificar(err);
  const respuesta = status >= 500 && esRutaPublica(req) ? MENSAJE_500_PUBLICO : mensaje;

  if (err && err.reintentarEn !== undefined) res.setHeader("Retry-After", err.reintentarEn);
  return res.status(status).json({ error: respuesta });
}

// Ruta inexistente: al final de las rutas, antes del manejador.
function rutaNoEncontrada(req, res, next) {
  next(new ErrorNoEncontrado("Ruta no encontrada."));
}

module.exports = { manejoErrores, rutaNoEncontrada, clasificar, esRutaPublica, MENSAJE_500, MENSAJE_500_PUBLICO };
