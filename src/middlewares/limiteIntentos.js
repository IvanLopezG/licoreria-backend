// Limitador de intentos por IP para las rutas públicas del catálogo, sin
// dependencias: ventana fija en memoria. Se reinicia con el proceso y cuenta
// por instancia (Render free corre una sola). req.ip es la IP real del cliente
// porque app.js confía en el primer proxy (trust proxy = 1).
//
// soloFallos: solo cuentan las respuestas 401/404 (token de mesa o de sesión
// inválido), así el uso normal nunca se bloquea y adivinar tokens sí.
function limiteIntentos({ ventanaMs, maximo, soloFallos = false }) {
  const contadores = new Map(); // ip -> { n, reinicio }

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
    const ip = req.ip || "desconocida";
    const c = contadores.get(ip);
    if (c && c.reinicio > ahora && c.n >= maximo) {
      res.setHeader("Retry-After", Math.ceil((c.reinicio - ahora) / 1000));
      return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." });
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
