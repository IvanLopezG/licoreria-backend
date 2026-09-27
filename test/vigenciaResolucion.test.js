// Vigencia de la resolución en hora de Colombia y código 409 al facturar con
// la resolución vencida o el rango agotado. Por HTTP con la app real (auth,
// controlador, servicio, ventaModel y facturaModel); la base se reemplaza por
// una transacción en memoria que solo aplica las escrituras si nada falla
// (como COMMIT/ROLLBACK). El reloj se fija con mock.timers.
//
// DATABASE_URL apunta a un puerto local cerrado ANTES de cargar la app: dotenv
// no sobrescribe variables ya definidas, así que el .env (Supabase) nunca se usa.
process.env.DATABASE_URL = "postgresql://prueba:prueba@127.0.0.1:1/sin_base";
process.env.JWT_SECRET = "secreto-solo-para-pruebas";

const test = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");
const db = require("../src/db/db");
const productoModel = require("../src/models/productoModel");
const emisorModel = require("../src/models/emisorModel");
const movimientoInventarioModel = require("../src/models/movimientoInventarioModel");
const facturaElectronicaModel = require("../src/models/facturaElectronicaModel");
const resolucionModel = require("../src/models/resolucionModel");
const logAuditoriaModel = require("../src/models/logAuditoriaModel");
const { hoyColombia } = require("../src/utils/fechaColombia");

// Último día de vigencia: 30 de septiembre. 01:00 UTC del 1 de octubre son las
// 8:00 p. m. del 30 en Colombia; 05:00 UTC del 1 es la medianoche en Colombia.
const ULTIMO_DIA = "2026-09-30";
const OCHO_PM_COLOMBIA = Date.parse("2026-10-01T01:00:00Z");
const MEDIANOCHE_COLOMBIA = Date.parse("2026-10-01T05:00:00Z");

// ---------- Base en memoria ----------
let secuencia;
let confirmadas; // escrituras aplicadas (COMMIT)
function reiniciar(cambios = {}) {
  secuencia = {
    id_secuencia: 1, prefijo: "FV", numero_actual: 0, rango_desde: 1, rango_hasta: 100,
    resolucion_numero: "18764000001", resolucion_fecha: "2026-09-01", vigencia_desde: "2026-09-01",
    vigencia_hasta: ULTIMO_DIA, activa: 1, fecha_registro: "2026-09-01 00:00:00", clave_tecnica: "clave",
    ...cambios,
  };
  confirmadas = [];
}

// Cada transacción acumula sus escrituras y solo las aplica si fn termina bien.
db.conTransaccion = async (fn) => {
  const pendientes = [];
  const cx = {
    async uno(sql, params) {
      if (sql.includes("FROM secuencias_factura")) return { ...secuencia };
      if (sql.startsWith("INSERT INTO ventas")) { pendientes.push("venta"); return { id_venta: 1 }; }
      if (sql.startsWith("INSERT INTO facturas")) { pendientes.push("factura"); return { id_factura: 1 }; }
      if (sql.includes("FROM facturas f")) return { id_factura: 1, numero_completo: `FV${secuencia.numero_actual}` };
      if (sql.includes("FROM ventas v")) return { id_venta: 1, tipo: "mostrador" };
      throw new Error(`Consulta no prevista en la prueba: ${sql}`);
    },
    async todos() { return []; },
    async ejecutar(sql, params) {
      if (sql.startsWith("UPDATE secuencias_factura")) pendientes.push(() => { secuencia.numero_actual = params[0]; });
      else pendientes.push(sql.split(" ").slice(0, 3).join(" "));
      return { rowCount: 1 };
    },
  };
  const resultado = await fn(cx);
  for (const p of pendientes) (typeof p === "function" ? p() : confirmadas.push(p));
  return resultado;
};
productoModel.buscarPorId = async (id) => ({ id_producto: id, nombre: "Ron", precio: 45000, activo: 1 });
emisorModel.obtener = async () => ({ razon_social: "Licorera", nit: "900123456", dv: "8", modo_facturacion: "interno", responsable_iva: 1, responsable_inc: 1 });
movimientoInventarioModel.verificarStockParaVenta = async () => {};
movimientoInventarioModel.descontarPorVenta = async (_, cx) => { await cx.ejecutar("UPDATE productos SET stock_actual", []); };
facturaElectronicaModel.buscarPorFactura = async () => null;
logAuditoriaModel.registrar = async () => {};

// Panel y registro de resoluciones: el modelo lee la misma secuencia en memoria.
resolucionModel.activa = async () => ({ ...secuencia, clave_tecnica_configurada: true });
resolucionModel.activaParaActualizar = resolucionModel.activa;
resolucionModel.historicas = async () => [];
resolucionModel.contarFacturas = async () => secuencia.numero_actual;
resolucionModel.ultimoNumeroConPrefijo = async () => secuencia.numero_actual;
resolucionModel.registrar = async (datos) => { secuencia = { ...secuencia, ...datos, id_secuencia: 2 }; return 2; };

const app = require("../src/app");

const ADMIN = jwt.sign({ id_usuario: 1, usuario_login: "admin", rol: "administrador" }, process.env.JWT_SECRET);

let base;
let servidor;
test.before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());
test.beforeEach(() => reiniciar());
test.afterEach((t) => t.mock.timers.reset());

function fijarReloj(t, ahora) {
  t.mock.timers.enable({ apis: ["Date"], now: ahora });
}

async function pedir(ruta, metodo = "GET", body) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const vender = () => pedir("/api/ventas", "POST", { items: [{ id_producto: 1, cantidad: 1 }] });

// ---------- Fecha de Colombia ----------
test("hoyColombia: UTC-5 fijo, cambia de día a la medianoche de Colombia", () => {
  assert.strictEqual(hoyColombia(new Date(OCHO_PM_COLOMBIA)), "2026-09-30");
  assert.strictEqual(hoyColombia(new Date("2026-10-01T04:59:59Z")), "2026-09-30"); // 11:59:59 p. m.
  assert.strictEqual(hoyColombia(new Date(MEDIANOCHE_COLOMBIA)), "2026-10-01");
});

// ---------- Al facturar ----------
test("el último día de vigencia sigue facturando a las 8:00 p. m. hora de Colombia", async (t) => {
  fijarReloj(t, OCHO_PM_COLOMBIA);
  const r = await vender();
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(secuencia.numero_actual, 1);
  assert.ok(confirmadas.includes("venta") && confirmadas.includes("factura"));
});

test("al día siguiente en hora de Colombia bloquea con 409 y revierte todo", async (t) => {
  fijarReloj(t, MEDIANOCHE_COLOMBIA);
  const r = await vender();
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, "La resolución de numeración de facturas está vencida.");
  assert.strictEqual(secuencia.numero_actual, 0);
  assert.deepStrictEqual(confirmadas, []); // sin venta, factura ni descuento de stock
});

test("rango agotado responde 409 (no 500) y revierte todo", async (t) => {
  fijarReloj(t, OCHO_PM_COLOMBIA);
  reiniciar({ numero_actual: 100 });
  const r = await vender();
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, "Se agotó el rango de numeración de facturas.");
  assert.strictEqual(secuencia.numero_actual, 100);
  assert.deepStrictEqual(confirmadas, []);
});

test("resolución vencida hace días responde 409 (no 500)", async (t) => {
  fijarReloj(t, OCHO_PM_COLOMBIA);
  reiniciar({ vigencia_hasta: "2026-09-15" });
  const r = await vender();
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, "La resolución de numeración de facturas está vencida.");
  assert.deepStrictEqual(confirmadas, []);
});

// ---------- Panel y registro de resoluciones ----------
test("panel: el último día a las 8:00 p. m. de Colombia quedan 0 días y no sale vencida", async (t) => {
  fijarReloj(t, OCHO_PM_COLOMBIA);
  const r = await pedir("/api/emisor/resolucion");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.activa.dias_para_vencer, 0);
  assert.ok(!r.body.activa.alertas.some((a) => a.nivel === "roja"), JSON.stringify(r.body.activa.alertas));
});

test("panel: al día siguiente en Colombia sale vencida (aviso rojo)", async (t) => {
  fijarReloj(t, MEDIANOCHE_COLOMBIA);
  const r = await pedir("/api/emisor/resolucion");
  assert.strictEqual(r.body.activa.dias_para_vencer, -1);
  assert.ok(r.body.activa.alertas.some((a) => a.nivel === "roja" && a.mensaje.includes("venció")));
});

const NUEVA = {
  prefijo: "FE", resolucion_numero: "18764000002", resolucion_fecha: "2026-09-01",
  rango_desde: 1, rango_hasta: 500, vigencia_desde: "2026-09-01", vigencia_hasta: ULTIMO_DIA,
};

test("registrar: se acepta una resolución que vence hoy en Colombia aunque en UTC ya sea mañana", async (t) => {
  fijarReloj(t, OCHO_PM_COLOMBIA);
  const r = await pedir("/api/emisor/resolucion", "POST", NUEVA);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
});

test("registrar: al día siguiente en Colombia se rechaza por vencida", async (t) => {
  fijarReloj(t, MEDIANOCHE_COLOMBIA);
  const r = await pedir("/api/emisor/resolucion", "POST", NUEVA);
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /La vigencia terminó/);
});
