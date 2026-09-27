const { ErrorApp, ErrorNoEncontrado } = require("../utils/errores");
const registro = require("../utils/logger");

// Manejador central de errores: el único lugar donde un error se convierte en
// respuesta HTTP. La forma es siempre { error: mensaje }, la que leen el panel
// web (api.js), la app Android (ErrorResponse) y el catálogo.
//
// - ErrorApp: su status y su mensaje, tal cual (los decidió el negocio).
// - Errores 4xx de librerías (http-errors con expose: body-parser, express.static):
//   conservan su código, con mensaje en español.
// - Cualquier otro error (pg, un bug): 500 con mensaje genérico; nunca el texto
//   de la excepción ni el stack.
// - Rutas públicas del catálogo (/api/catalogo): los 500 siempre con mensaje
//   genérico, aunque sean ErrorInterno; los 4xx de negocio se muestran igual.
// - Log (Pino): 5xx en nivel error con el stack; 4xx en warn sin stack. El stack
//   solo va al log, nunca a la respuesta. Ver utils/logger.js (redacción).

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
  if (err && err.expose === true && status >= 400 && status < 500) {
    return { status, mensaje: MENSAJES_BODY_PARSER[err.type] || "La petición no es válida.", esperado: true };
  }
  return { status: 500, mensaje: MENSAJE_500, esperado: false };
}

// eslint-disable-next-line no-unused-vars -- Express reconoce el manejador por sus 4 argumentos.
function manejoErrores(err, req, res, next) {
  if (res.headersSent) return next(err);

  const { status, mensaje } = clasificar(err);
  const respuesta = status >= 500 && esRutaPublica(req) ? MENSAJE_500_PUBLICO : mensaje;
  registrar(err, req, status);

  if (err && err.reintentarEn !== undefined) res.setHeader("Retry-After", err.reintentarEn);
  return res.status(status).json({ error: respuesta });
}

function registrar(err, req, status) {
  const secretos = registro.secretosDe(req);
  const datos = {
    status,
    metodo: req.method,
    ruta: registro.rutaSegura(req.originalUrl),
    tipo: err && err.name,
    codigo: (err && (err.codigo || err.code)) || undefined,
    mensaje: registro.limpiarTexto(err && err.message !== undefined ? err.message : String(err), secretos),
  };
  if (status >= 500) registro.logger.error({ ...datos, stack: registro.limpiarTexto(err && err.stack, secretos) }, "error del servidor");
  else registro.logger.warn(datos, "error de la petición");
}

// Ruta inexistente: al final de las rutas, antes del manejador.
function rutaNoEncontrada(req, res, next) {
  next(new ErrorNoEncontrado("Ruta no encontrada."));
}

module.exports = { manejoErrores, rutaNoEncontrada, clasificar, esRutaPublica, MENSAJE_500, MENSAJE_500_PUBLICO };
