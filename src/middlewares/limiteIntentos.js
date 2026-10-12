const { ErrorDemasiadosIntentos } = require("../utils/errores");

// Limitador de intentos por IP para las rutas públicas del catálogo, sin
// dependencias: ventana fija en memoria. Se reinicia con el proceso y cuenta
// por instancia (Render free corre una sola). req.ip es la IP real del cliente
// porque app.js confía en el primer proxy (trust proxy = 1).
//
// soloFallos: solo cuentan las respuestas 401/404 (token de mesa o de sesión
// inválido), así el uso normal nunca se bloquea y adivinar tokens sí.
//
// clave: de quién se cuenta (por defecto la IP); el chatbot cuenta por usuario.
// mensaje: texto del 429.
const MENSAJE = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";

function limiteIntentos({ ventanaMs, maximo, soloFallos = false, clave = (req) => req.ip || "desconocida", mensaje = MENSAJE }) {
  const contadores = new Map(); // clave -> { n, reinicio }

  function purgar(ahora) {
    if (contadores.size < 5000) return;
    for (const [ip, c] of contadores) if (c.reinicio <= ahora) contadores.delete(ip);
  }

  function contar(ip, ahora) {
    const c = contadores.get(ip);
    if (!c || c.reinicio <= ahora) contadores.set(ip, { n: 1, reinicio: ahora + ventanaMs });
    else c.n += 1;
  }

  return (req, res, next) => {
    const ahora = Date.now();
    purgar(ahora);
    const ip = clave(req);
    const c = contadores.get(ip);
    if (c && c.reinicio > ahora && c.n >= maximo) {
      // El manejador central pone Retry-After con reintentarEn.
      return next(
        new ErrorDemasiadosIntentos(
          mensaje,
          Math.ceil((c.reinicio - ahora) / 1000)
        )
      );
    }
    if (soloFallos) {
      res.on("finish", () => {
        if (res.statusCode === 401 || res.statusCode === 404) contar(ip, Date.now());
      });
    } else {
      contar(ip, ahora);
    }
    return next();
  };
}

module.exports = limiteIntentos;
