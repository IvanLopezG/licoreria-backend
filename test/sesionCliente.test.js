// Vista pública del cliente (sesión de mesa del catálogo QR): vencimiento con
// SESION_FACTURA_MINUTOS, 401/410, ETag y documento enmascarado. Modelos en
// memoria: sin base de datos. El flujo completo contra Postgres local está en
// scripts/prueba-sesiones-mesa.js.
process.env.DATABASE_URL = "postgresql://prueba:prueba@127.0.0.1:1/sin_base";

const test = require("node:test");
const assert = require("node:assert");
const mesaSesionModel = require("../src/models/mesaSesionModel");
const mesaModel = require("../src/models/mesaModel");
const pedidoModel = require("../src/models/pedidoModel");
const facturaModel = require("../src/models/facturaModel");
const servicio = require("../src/services/clienteSesionService");
const limiteIntentos = require("../src/middlewares/limiteIntentos");

let sesion;
mesaSesionModel.buscarPorToken = async (t) => (t === "token-valido-de-prueba-123456" ? { ...sesion } : undefined);
mesaModel.buscarPorId = async () => ({ numero: 4 });
pedidoModel.listarPorSesion = async () => [
  { id_pedido: 99, estado: "entregado", fecha_hora: "2026-09-27 20:00:00", items: [{ producto_nombre: "Ron", cantidad: 2, precio_unitario: 1000 }] },
];
let factura;
facturaModel.buscarPorId = async () => factura;

const CIERRE = "2026-09-27 20:00:00";
const CIERRE_MS = Date.parse("2026-09-27T20:00:00Z");
test.beforeEach(() => {
  delete process.env.SESION_FACTURA_MINUTOS;
  sesion = { id_token: 1, id_sesion: 7, id_mesa: 3, estado: "cerrada", cerrada_en: CIERRE, revision: 5, id_factura: 11, reabierta: 0, revocado_en: null };
  factura = {
    id_factura: 11, estado: "emitida", numero_completo: "FV12", titulo_documento: "FACTURA", fecha_expedicion: CIERRE,
    emisor_razon_social: "Licorera", emisor_nit: "900123456", emisor_dv: "8", emisor_direccion: "Calle 1",
    emisor_municipio: "Bucaramanga", emisor_departamento: "Santander", emisor_telefono: null, emisor_regimen: "Simple",
    cliente_nombre: "Ana", cliente_tipo_doc: "CC", cliente_num_doc: "1098765432", cliente_correo: "ana@x.co",
    items: [{ descripcion: "Ron", cantidad: 2, precio_unitario: 1000, tasa_iva_bps: 0, tasa_inc_bps: 800, total_linea: 2000, base_linea: 1852 }],
    subtotal: 1852, total_iva: 0, total_inc: 148, total: 2000, forma_pago: "efectivo", leyenda_pie: "Gracias",
  };
});
test.afterEach((t) => t.mock.timers.reset());

const TOKEN = "token-valido-de-prueba-123456";
const reloj = (t, ms) => t.mock.timers.enable({ apis: ["Date"], now: ms });

test("token inexistente o ausente → 401 genérico", async () => {
  for (const t of [undefined, "", "otro-token-cualquiera-1234567"]) {
    await assert.rejects(servicio.autenticar(t), (e) => e.status === 401 && e.message === "Sesión no válida.");
  }
});

test("factura visible hasta 30 minutos después del cierre; luego 410", async (t) => {
  reloj(t, CIERRE_MS + 29 * 60000);
  assert.strictEqual((await servicio.autenticar(TOKEN)).id_sesion, 7);
  t.mock.timers.setTime(CIERRE_MS + 30 * 60000 + 1000);
  await assert.rejects(servicio.autenticar(TOKEN), (e) => e.status === 410);
});

test("SESION_FACTURA_MINUTOS cambia el vencimiento; un valor inválido usa 30", async (t) => {
  process.env.SESION_FACTURA_MINUTOS = "5";
  reloj(t, CIERRE_MS + 6 * 60000);
  await assert.rejects(servicio.autenticar(TOKEN), (e) => e.status === 410);
  process.env.SESION_FACTURA_MINUTOS = "abc";
  assert.strictEqual(servicio.minutosVigencia(), 30);
});

test("token revocado ('Listo') o sesión cancelada → 410", async (t) => {
  reloj(t, CIERRE_MS + 60000);
  sesion.revocado_en = "2026-09-27 20:01:00";
  await assert.rejects(servicio.autenticar(TOKEN), (e) => e.status === 410);
  sesion.revocado_en = null;
  sesion.estado = "cancelada";
  await assert.rejects(servicio.autenticar(TOKEN), (e) => e.status === 410);
});

test("sesión activa no vence", async (t) => {
  reloj(t, CIERRE_MS + 10 * 3600000);
  sesion.estado = "activa";
  sesion.cerrada_en = null;
  assert.ok(await servicio.autenticar(TOKEN));
});

test("vista: documento enmascarado, sin correo ni ids internos; ETag cambia con la revisión", async () => {
  const v = await servicio.estado(sesion);
  assert.strictEqual(v.factura.cliente.documento, "CC *******432");
  const texto = JSON.stringify(v);
  assert.ok(!texto.includes("1098765432") && !texto.includes("ana@x.co"));
  assert.ok(!/"id_[a-z]+"/.test(texto), texto);
  assert.strictEqual(v.vence_en, "2026-09-27 20:30:00");
  assert.notStrictEqual(servicio.etagDe(sesion), servicio.etagDe({ ...sesion, revision: 6 }));
});

test("factura anulada: la vista no trae sus datos y el PDF responde 410", async () => {
  factura.estado = "anulada";
  const v = await servicio.estado(sesion);
  assert.strictEqual(v.factura, null);
  assert.strictEqual(v.factura_anulada, true);
  await assert.rejects(servicio.facturaParaPdf(sesion), (e) => e.status === 410);
});

test("limitador: con soloFallos solo cuentan 401/404; al llegar al máximo → ErrorDemasiadosIntentos (429)", () => {
  const mw = limiteIntentos({ ventanaMs: 60000, maximo: 2, soloFallos: true });
  const llamar = (status) => {
    let fin;
    const res = {
      statusCode: status, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(s) { this.statusCode = s; return this; },
      json() { return this; },
      on(ev, fn) { fin = fn; },
    };
    let error;
    let siguio = false;
    mw({ ip: "1.2.3.4" }, res, (err) => { siguio = true; error = err; });
    if (error) return `${error.status} ${error.reintentarEn > 0} ${error.message}`;
    if (siguio && fin) fin();
    return "sigue";
  };
  assert.strictEqual(llamar(200), "sigue");
  assert.strictEqual(llamar(200), "sigue");
  assert.strictEqual(llamar(401), "sigue");
  assert.strictEqual(llamar(404), "sigue");
  assert.strictEqual(llamar(200), "429 true Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
});
