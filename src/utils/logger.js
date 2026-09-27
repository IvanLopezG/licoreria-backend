const pino = require("pino");

// Logger estructurado de la aplicación (Pino).
//
// - Producción (Render): JSON crudo, una línea por evento, a stdout.
// - Desarrollo local: legible con pino-pretty (devDependency) solo si la salida
//   es una terminal o LOG_PRETTY=1, nunca con NODE_ENV=production. En Render la
//   salida no es una terminal: aunque pino-pretty estuviera instalado, no se carga.
// - Nivel: LOG_LEVEL (info por defecto); bajo `node --test`, silent salvo que
//   LOG_LEVEL diga otra cosa.
//
// Secretos: contraseñas, tokens (JWT del panel, token de sesión del catálogo) y
// la clave técnica de la resolución NUNCA van a un log. Tres capas:
// 1. Los middlewares solo registran campos elegidos (método, ruta, código,
//    tiempo, mensaje): nunca cuerpos, encabezados ni la query string.
// 2. redact de Pino sobre esos nombres de campo, a cualquier profundidad usual.
// 3. limpiarTexto() en rutas, mensajes y stacks: quita JWT, tokens largos y el
//    token del QR de la mesa en la URL del catálogo.
// 4. En los errores, además, los valores exactos que llegaron en esa petición en
//    campos secretos (cuerpo, Authorization, X-Sesion-Token, token del QR), por
//    si una excepción los repite en su mensaje (p. ej. una clave técnica corta).

const CAMPOS_SECRETOS = [
  "password",
  "password_hash",
  "contrasena",
  "token",
  "token_sesion",
  "codigo_qr_token",
  "clave_tecnica",
  "authorization",
  "cookie",
  "JWT_SECRET",
];
const ENCABEZADOS_SECRETOS = ["x-sesion-token", "set-cookie"];

const REDACTAR = [
  ...CAMPOS_SECRETOS.flatMap((c) => [c, `*.${c}`, `*.*.${c}`, `*.*.*.${c}`]),
  ...ENCABEZADOS_SECRETOS.flatMap((c) => [`["${c}"]`, `*["${c}"]`, `*.*["${c}"]`, `*.*.*["${c}"]`]),
];
const CENSURA = "[REDACTADO]";

// JWT (tres partes base64url, la primera empieza por eyJ) y cualquier cadena
// base64url/hex de 32+ caracteres (tokens de sesión, token del QR, hashes).
const PATRON_JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const PATRON_TOKEN_LARGO = /\b[A-Za-z0-9_-]{32,}\b/g;

// secretos: valores concretos a borrar además de los patrones (ver secretosDe).
function limpiarTexto(texto, secretos = []) {
  if (typeof texto !== "string") return texto;
  let limpio = texto;
  for (const s of secretos) limpio = limpio.split(s).join(CENSURA);
  return limpio.replace(PATRON_JWT, CENSURA).replace(PATRON_TOKEN_LARGO, CENSURA);
}

// Valores de los campos secretos que trae la petición (cuerpo a cualquier
// profundidad, encabezados y token del QR en la URL). Solo cadenas de 4+
// caracteres, para no borrar texto común.
function secretosDe(req) {
  const valores = [];
  const nombres = new Set(CAMPOS_SECRETOS.map((c) => c.toLowerCase()));
  const recorrer = (obj, profundidad) => {
    if (!obj || typeof obj !== "object" || profundidad > 5) return;
    for (const [clave, valor] of Object.entries(obj)) {
      if (nombres.has(clave.toLowerCase()) && typeof valor === "string") valores.push(valor);
      else recorrer(valor, profundidad + 1);
    }
  };
  recorrer(req && req.body, 0);
  const auth = req && req.headers && req.headers.authorization;
  if (typeof auth === "string") valores.push(auth.replace(/^Bearer\s+/i, ""));
  const sesion = req && req.headers && req.headers["x-sesion-token"];
  if (typeof sesion === "string") valores.push(sesion);
  const qr = /^\/api\/catalogo\/([^/?]+)/.exec((req && req.originalUrl) || "");
  if (qr && qr[1] !== "sesion") {
    try {
      valores.push(decodeURIComponent(qr[1]));
    } catch {
      valores.push(qr[1]);
    }
  }
  return valores.filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
}

// Ruta para el log: sin query string (puede traer filtros o un token pegado
// por error) y sin el token del QR de la mesa (/api/catalogo/<token>/...).
function rutaSegura(url = "") {
  const sinQuery = String(url).split("?")[0];
  return limpiarTexto(sinQuery.replace(/^\/api\/catalogo\/(?!sesion(\/|$))[^/]+/, "/api/catalogo/:token"));
}

function nivelPorDefecto() {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  return process.env.NODE_TEST_CONTEXT ? "silent" : "info";
}

function usarPretty() {
  if (process.env.NODE_ENV === "production" || process.env.LOG_PRETTY === "0") return false;
  if (process.env.LOG_PRETTY !== "1" && !process.stdout.isTTY) return false;
  try {
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false; // devDependency no instalada: JSON crudo
  }
}

// destino: stream opcional (las pruebas capturan la salida con él).
function crearLogger({ destino, nivel = nivelPorDefecto() } = {}) {
  const opciones = {
    level: nivel,
    base: undefined, // sin pid ni hostname: Render ya identifica la instancia
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTAR, censor: CENSURA },
  };
  if (destino) return pino(opciones, destino);
  if (usarPretty()) {
    return pino({
      ...opciones,
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } },
    });
  }
  return pino(opciones);
}

// Los middlewares leen registro.logger en cada uso: una prueba puede
// reemplazarlo por uno con destino propio.
const registro = { logger: crearLogger(), crearLogger, limpiarTexto, secretosDe, rutaSegura, REDACTAR, CENSURA };

module.exports = registro;
