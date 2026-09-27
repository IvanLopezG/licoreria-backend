// Resolución de numeración: permisos, reglas de numeración y que la clave
// técnica nunca salga en la API. Por HTTP con la app real (auth, requireRole,
// controlador, servicio y bitácora) y el modelo en memoria: sin base de datos.
//
// DATABASE_URL apunta a un puerto local cerrado ANTES de cargar la app: dotenv
// no sobrescribe variables ya definidas, así que el .env (Supabase) nunca se usa.
process.env.DATABASE_URL = "postgresql://prueba:prueba@127.0.0.1:1/sin_base";
process.env.JWT_SECRET = "secreto-solo-para-pruebas";

const test = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");
const db = require("../src/db/db");
const resolucionModel = require("../src/models/resolucionModel");
const logAuditoriaModel = require("../src/models/logAuditoriaModel");

const CLAVE = "clave-super-secreta-123";

// ---------- Estado en memoria ----------
let secuencias; // filas completas, CON clave_tecnica (como la tabla)
let facturas; // [{ id_secuencia, numero }]
let bitacora;
function reiniciar() {
  secuencias = [{
    id_secuencia: 1, prefijo: "FV", numero_actual: 0, rango_desde: 1, rango_hasta: 100,
    resolucion_numero: "18764000001", resolucion_fecha: "2026-09-01", vigencia_desde: "2026-09-01",
    vigencia_hasta: "2099-09-01", activa: 1, fecha_registro: "2026-09-01 00:00:00", clave_tecnica: CLAVE,
  }];
  facturas = [];
  bitacora = [];
}
// Como en la base: el modelo lee todo. Si el servicio filtrara mal, la clave saldría.
const conIndicador = (s) => s && { ...s, clave_tecnica_configurada: !!s.clave_tecnica };
resolucionModel.activa = async () => conIndicador(secuencias.find((s) => s.activa === 1));
resolucionModel.activaParaActualizar = resolucionModel.activa;
resolucionModel.historicas = async () => secuencias.filter((s) => s.activa === 0).map(conIndicador);
resolucionModel.contarFacturas = async (id) => facturas.filter((f) => f.id_secuencia === id).length;
resolucionModel.ultimoNumeroConPrefijo = async (prefijo) => Math.max(0, ...facturas
  .filter((f) => (secuencias.find((s) => s.id_secuencia === f.id_secuencia).prefijo ?? null) === (prefijo ?? null))
  .map((f) => f.numero));
resolucionModel.registrar = async (datos) => {
  secuencias.forEach((s) => { s.activa = 0; });
  const id_secuencia = secuencias.length + 1;
  secuencias.push({ ...datos, clave_tecnica: datos.clave_tecnica ?? null, id_secuencia, activa: 1, fecha_registro: "2026-09-26 00:00:00" });
  return id_secuencia;
};
resolucionModel.actualizar = async (id, datos) => {
  const s = secuencias.find((x) => x.id_secuencia === id);
  const { clave_tecnica, ...resto } = datos;
  Object.assign(s, resto);
  if (clave_tecnica !== undefined) s.clave_tecnica = clave_tecnica;
};
db.conTransaccion = async (fn) => fn({});
logAuditoriaModel.registrar = async (registro) => { bitacora.push(registro); };

const app = require("../src/app");

const token = (rol) => jwt.sign({ id_usuario: 1, usuario_login: rol, rol }, process.env.JWT_SECRET);
const ADMIN = token("administrador");

let servidor;
let base;
test.before(() => new Promise((listo) => {
  servidor = app.listen(0, () => {
    base = `http://127.0.0.1:${servidor.address().port}`;
    listo();
  });
}));
test.after(() => new Promise((listo) => servidor.close(listo)));
test.beforeEach(reiniciar);

async function pedir(metodo, tokenRol, body) {
  const res = await fetch(`${base}/api/emisor/resolucion`, {
    method: metodo,
    headers: { Authorization: `Bearer ${tokenRol}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  return { status: res.status, texto, json: JSON.parse(texto) };
}

const resolucion = (cambios = {}) => ({
  prefijo: "FV", resolucion_numero: "18764000002", resolucion_fecha: "2026-09-20", rango_desde: 1,
  rango_hasta: 500, vigencia_desde: "2026-09-20", vigencia_hasta: "2099-09-20", ...cambios,
});

test("administrador edita la resolución activa sin facturas → 200", async () => {
  const r = await pedir("PUT", ADMIN, resolucion({ rango_hasta: 800 }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.activa.rango_hasta, 800);
  assert.strictEqual(r.json.activa.resolucion_numero, "18764000002");
  assert.strictEqual(secuencias[0].rango_hasta, 800);
});

test("cajero y mesero reciben 403 en ver, editar y registrar", async () => {
  for (const rol of ["cajero", "mesero"]) {
    for (const metodo of ["GET", "PUT", "POST"]) {
      const r = await pedir(metodo, token(rol), metodo === "GET" ? undefined : resolucion());
      assert.strictEqual(r.status, 403, `${rol} ${metodo}`);
    }
  }
  assert.strictEqual(secuencias.length, 1);
  assert.strictEqual(secuencias[0].resolucion_numero, "18764000001");
});

test("la clave técnica nunca aparece en el GET: solo el indicador", async () => {
  const r = await pedir("GET", ADMIN);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.activa.clave_tecnica_configurada, true);
  assert.ok(!("clave_tecnica" in r.json.activa));
  assert.ok(!r.texto.includes(CLAVE));
});

test("la clave técnica vacía se conserva al editar, y la bitácora no guarda su valor", async () => {
  let r = await pedir("PUT", ADMIN, resolucion({ clave_tecnica: "" }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(secuencias[0].clave_tecnica, CLAVE);
  r = await pedir("PUT", ADMIN, resolucion({ clave_tecnica: "otra-clave-nueva" }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(secuencias[0].clave_tecnica, "otra-clave-nueva");
  assert.ok(!r.texto.includes("otra-clave-nueva"));
  const ultimo = bitacora[bitacora.length - 1];
  assert.strictEqual(ultimo.entidad, "secuencias_factura");
  assert.match(ultimo.detalle, /clave_tecnica/);
  assert.ok(!JSON.stringify(bitacora).includes("otra-clave-nueva") && !JSON.stringify(bitacora).includes(CLAVE));
});

test("no se puede bajar el consecutivo ni reusar números con el mismo prefijo → 409", async () => {
  facturas.push({ id_secuencia: 1, numero: 1 }, { id_secuencia: 1, numero: 2 });
  secuencias[0].numero_actual = 2;
  for (const desde of [1, 2]) {
    const r = await pedir("POST", ADMIN, resolucion({ rango_desde: desde }));
    assert.strictEqual(r.status, 409, `rango_desde ${desde}`);
    assert.match(r.json.error, /no se puede reusar ni retroceder.*empezar en 3/);
  }
  assert.strictEqual(secuencias.length, 1);
  // Otro prefijo no comparte numeración: puede empezar en 1.
  const otro = await pedir("POST", ADMIN, resolucion({ prefijo: "FE", rango_desde: 1 }));
  assert.strictEqual(otro.status, 201);
});

test("una resolución que ya emitió facturas no se edita (las facturas no copian sus datos) → 409", async () => {
  facturas.push({ id_secuencia: 1, numero: 1 });
  secuencias[0].numero_actual = 1;
  const r = await pedir("PUT", ADMIN, resolucion({ rango_hasta: 900 }));
  assert.strictEqual(r.status, 409);
  assert.match(r.json.error, /ya emitió 1 factura/);
  assert.strictEqual(secuencias[0].rango_hasta, 100);
  const get = await pedir("GET", ADMIN);
  assert.strictEqual(get.json.activa.editable, false);
});

test("registrar una nueva la deja activa y la anterior queda como histórica → 201", async () => {
  facturas.push({ id_secuencia: 1, numero: 1 });
  secuencias[0].numero_actual = 1;
  const r = await pedir("POST", ADMIN, resolucion({ rango_desde: 2, clave_tecnica: "clave-de-la-nueva" }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.activa.id_secuencia, 2);
  assert.strictEqual(r.json.activa.siguiente_numero, 2);
  assert.strictEqual(r.json.historicas.length, 1);
  assert.strictEqual(r.json.historicas[0].resolucion_numero, "18764000001");
  assert.strictEqual(secuencias.filter((s) => s.activa === 1).length, 1);
  assert.strictEqual(secuencias[0].rango_hasta, 100); // la histórica queda intacta
  assert.ok(!r.texto.includes("clave-de-la-nueva"));
  assert.strictEqual(bitacora[bitacora.length - 1].accion, "crear");
});

test("validaciones del servidor con mensajes en español → 400", async () => {
  const casos = [
    [{ prefijo: "F-1" }, /prefijo/],
    [{ prefijo: "PREFIJO" }, /prefijo/],
    [{ resolucion_numero: "18A" }, /número de resolución/],
    [{ rango_desde: 50, rango_hasta: 10 }, /inicio del rango/],
    [{ rango_desde: 0 }, /rango/],
    [{ vigencia_desde: "2099-09-20", vigencia_hasta: "2099-09-20" }, /vigencia debe terminar después/],
    [{ resolucion_fecha: "2026-02-30" }, /fecha de la resolución/],
    [{ vigencia_desde: "2024-01-01", vigencia_hasta: "2025-01-01" }, /vigencia terminó/],
  ];
  for (const [cambio, mensaje] of casos) {
    const r = await pedir("POST", ADMIN, resolucion(cambio));
    assert.strictEqual(r.status, 400, JSON.stringify(cambio));
    assert.match(r.json.error, mensaje);
  }
  assert.strictEqual(secuencias.length, 1);
});
