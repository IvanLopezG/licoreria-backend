const registro = require("../utils/logger");

// Una línea por petición al terminar de responder: método, ruta (sin query
// string ni token del QR), código y tiempo en ms. Nunca cuerpos ni
// encabezados. Nivel info siempre: los errores tienen además su propia línea
// (con stack si es 500) desde el manejador central.
function registroPeticiones(req, res, next) {
  const inicio = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    registro.logger.info(
      { metodo: req.method, ruta: registro.rutaSegura(req.originalUrl), status: res.statusCode, ms: Math.round(ms * 10) / 10 },
      "petición"
    );
  });
  next();
}

module.exports = registroPeticiones;
