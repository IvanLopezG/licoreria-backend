// Logging (Pino): una línea JSON por petición y por error, con el stack solo en
// el log de los 500, y sin contraseñas, tokens (JWT, sesión del catálogo, QR)
// ni la clave técnica, aunque una excepción los repita en su mensaje. App real
// con modelos en memoria y la salida del logger capturada: sin base de datos.
process.env.DATABASE_URL = "postgresql://prueba:prueba@127.0.0.1:1/sin_base";
process.env.JWT_SECRET = "secreto-solo-para-pruebas";

const test = require("node:test");
const assert = require("node:assert");
const { Writable } = require("stream");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../src/db/db");
const registro = require("../src/utils/logger");
const usuarioModel = require("../src/models/usuarioModel");
const resolucionModel = require("../src/models/resolucionModel");
const mesaModel = require("../src/models/mesaModel");
const mesaSesionModel = require("../src/models/mesaSesionModel");
const logAuditoriaModel = require("../src/models/logAuditoriaModel");

// ---------- Secretos de la prueba ----------
const PASSWORD = "ContrasenaSecreta-77";
const CLAVE_TECNICA = "ClaveCorta9"; // corta a propósito: sin forma de token
const TOKEN_SESION = "SesionSecreta_abcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_QR = "qrsecreto0123456789abcdef";
const JWT_ADMIN = jwt.sign({ id_usuario: 1, usuario_login: "admin", rol: "administrador" }, process.env.JWT_SECRET);
const SECRETOS = [PASSWORD, CLAVE_TECNICA, TOKEN_SESION, TOKEN_QR, JWT_ADMIN, JWT_ADMIN.split(".")[2]];

// ---------- Salida del logger capturada ----------
let lineas = [];
const destino = new Writable({
  write(trozo, _codificacion, listo) {
    lineas.push(...trozo.toString().split("\n").filter(Boolean));
    listo();
  },
});
registro.logger = registro.crearLogger({ destino, nivel: "debug" });
const registros = () => lineas.map((l) => JSON.parse(l));

// ---------- Modelos en memoria ----------
let fallarLogin = false;
usuarioModel.buscarPorLogin = async (login) => {
  if (fallarLogin) throw new Error(`consulta falló para usuario ${login} con clave ${PASSWORD}`);
  return { id_usuario: 1, usuario_login: login, activo: 1, rol: "administrador", password_hash: bcrypt.hashSync("otra", 4) };
};
usuarioModel.listar = async () => [{ id_usuario: 1, nombre: "Admin" }];
resolucionModel.ultimoNumeroConPrefijo = async () => 0;
resolucionModel.activaParaActualizar = async () => undefined;
resolucionModel.registrar = async (datos) => {
  throw new Error(`insert falló: clave_tecnica=${datos.clave_tecnica}`);
};
db.conTransaccion = async (fn) => fn({});
logAuditoriaModel.registrar = async () => {};
mesaModel.buscarPorToken = async () => undefined;
mesaSesionModel.buscarPorToken = async (t) => {
  throw new Error(`fallo buscando el token ${t}`);
};

const app = require("../src/app");

let base;
let servidor;
test.before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());
test.beforeEach(() => {
  lineas = [];
  fallarLogin = false;
});

async function pedir(ruta, { metodo = "GET", body, headers = {} } = {}) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  await new Promise((r) => setImmediate(r)); // deja escribir la línea de "finish"
  return { status: res.status, texto };
}

function sinSecretos() {
  const todo = lineas.join("\n");
  for (const s of SECRETOS) assert.ok(!todo.includes(s), `el log contiene un secreto: ${s.slice(0, 6)}…\n${todo}`);
}

test("petición normal: una línea JSON con método, ruta, código y tiempo; sin el JWT", async () => {
  const r = await pedir("/api/usuarios", { headers: { Authorization: `Bearer ${JWT_ADMIN}` } });
  assert.strictEqual(r.status, 200);
  const peticion = registros().find((l) => l.msg === "petición");
  assert.deepStrictEqual(
    { metodo: peticion.metodo, ruta: peticion.ruta, status: peticion.status, nivel: peticion.level },
    { metodo: "GET", ruta: "/api/usuarios", status: 200, nivel: 30 }
  );
  assert.strictEqual(typeof peticion.ms, "number");
  assert.match(peticion.time, /^\d{4}-\d{2}-\d{2}T/);
  sinSecretos();
});

test("login con contraseña incorrecta: warn con status y mensaje, sin la contraseña", async () => {
  const r = await pedir("/api/auth/login", { metodo: "POST", body: { usuario_login: "admin", password: PASSWORD } });
  assert.strictEqual(r.status, 401);
  const aviso = registros().find((l) => l.msg === "error de la petición");
  assert.strictEqual(aviso.level, 40);
  assert.strictEqual(aviso.status, 401);
  assert.strictEqual(aviso.mensaje, "Usuario o contraseña incorrectos.");
  assert.ok(!("stack" in aviso), "un 4xx no lleva stack");
  sinSecretos();
});

test("500 cuyo mensaje repite la contraseña: stack en el log (redactado), nunca en la respuesta", async () => {
  fallarLogin = true;
  const r = await pedir("/api/auth/login", { metodo: "POST", body: { usuario_login: "admin", password: PASSWORD } });
  assert.strictEqual(r.status, 500);
  assert.ok(!/at |\.js|consulta falló/.test(r.texto), r.texto);
  const error = registros().find((l) => l.msg === "error del servidor");
  assert.strictEqual(error.level, 50);
  assert.strictEqual(error.status, 500);
  assert.strictEqual(error.ruta, "/api/auth/login");
  assert.strictEqual(error.metodo, "POST");
  assert.match(error.mensaje, /consulta falló para usuario admin con clave \[REDACTADO\]/);
  assert.match(error.stack, /authService/);
  sinSecretos();
});

test("clave técnica corta repetida por una excepción: no aparece en el log", async () => {
  const r = await pedir("/api/emisor/resolucion", {
    metodo: "POST",
    headers: { Authorization: `Bearer ${JWT_ADMIN}` },
    body: {
      prefijo: "FE", resolucion_numero: "18764000002", resolucion_fecha: "2026-09-01", rango_desde: 1, rango_hasta: 500,
      vigencia_desde: "2026-09-01", vigencia_hasta: "2099-09-30", clave_tecnica: CLAVE_TECNICA,
    },
  });
  assert.strictEqual(r.status, 500);
  const error = registros().find((l) => l.msg === "error del servidor");
  assert.strictEqual(error.mensaje, "insert falló: clave_tecnica=[REDACTADO]");
  sinSecretos();
});

test("catálogo: token de sesión y token del QR fuera del log; 500 público con mensaje genérico", async () => {
  const r = await pedir("/api/catalogo/sesion/estado", { headers: { "X-Sesion-Token": TOKEN_SESION } });
  assert.strictEqual(r.status, 500);
  assert.deepStrictEqual(JSON.parse(r.texto), { error: "Ocurrió un error, intenta de nuevo." });
  const q = await pedir(`/api/catalogo/${TOKEN_QR}/pedidos?token=${TOKEN_SESION}`);
  assert.strictEqual(q.status, 404);
  const rutas = registros().filter((l) => l.msg === "petición").map((l) => l.ruta);
  assert.deepStrictEqual(rutas, ["/api/catalogo/sesion/estado", "/api/catalogo/:token/pedidos"]);
  sinSecretos();
});

test("redact de Pino: campos secretos en objetos logueados salen como [REDACTADO]", () => {
  registro.logger.info({
    password: PASSWORD,
    body: { clave_tecnica: CLAVE_TECNICA, usuario: { password: PASSWORD } },
    req: { headers: { authorization: `Bearer ${JWT_ADMIN}`, "x-sesion-token": TOKEN_SESION } },
    token_sesion: TOKEN_SESION,
  }, "prueba");
  const l = registros().find((x) => x.msg === "prueba");
  assert.strictEqual(l.password, "[REDACTADO]");
  assert.strictEqual(l.body.clave_tecnica, "[REDACTADO]");
  assert.strictEqual(l.body.usuario.password, "[REDACTADO]");
  assert.strictEqual(l.req.headers.authorization, "[REDACTADO]");
  assert.strictEqual(l.req.headers["x-sesion-token"], "[REDACTADO]");
  sinSecretos();
});
