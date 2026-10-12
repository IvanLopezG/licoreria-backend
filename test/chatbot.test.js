// POST /api/chatbot y GET /api/chatbot/preguntas.
//
// 1) Sin base de datos (siempre corren): app real por HTTP con JWT firmados en la
//    prueba, reporteService y alertaStockService reemplazados por datos fijos, y
//    Gemini SIMULADO (geminiService.dependencias.fetch). Además, cualquier fetch
//    real hacia Google falla a propósito: nunca se llama al Gemini real.
// 2) Integración con datos de prueba (cada pregunta rápida): solo con un Postgres
//    LOCAL desechable y recién creado, igual que test/reportes.test.js:
//      PRUEBA_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres node --test test/chatbot.test.js
const URL_PRUEBA = process.env.PRUEBA_DATABASE_URL || "";
let hostPrueba = "";
try {
  hostPrueba = new URL(URL_PRUEBA).hostname;
} catch {
  // sin base de prueba
}
const BASE_LOCAL = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostPrueba) && !/supabase/i.test(URL_PRUEBA);
if (BASE_LOCAL) {
  process.env.DATABASE_URL = URL_PRUEBA;
  process.env.PGSSLMODE = "disable";
} else {
  process.env.DATABASE_URL = "postgresql://prueba:prueba@127.0.0.1:1/sin_base";
}
process.env.JWT_SECRET = "secreto-solo-para-pruebas";
// Clave falsa con la forma de una de Google (AIza + 35): nunca debe aparecer en respuestas ni logs.
const CLAVE = "AIzaSyFALSA_solo_pruebas_0123456789abc";
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_MODEL;

const test = require("node:test");
const assert = require("node:assert");
const { Writable } = require("stream");
const jwt = require("jsonwebtoken");
const { firmarToken } = require("./apoyo/usuariosSimulados");

// Red real hacia Google bloqueada antes de cargar la app (el fetch al servidor local de la prueba sí pasa).
const fetchReal = globalThis.fetch;
let intentosGoogle = 0;
globalThis.fetch = (url, ...resto) => {
  if (String(url).includes("googleapis.com")) {
    intentosGoogle += 1;
    return Promise.reject(new Error("prueba: prohibido llamar al Gemini real"));
  }
  return fetchReal(url, ...resto);
};

const registro = require("../src/utils/logger");
let lineasLog = [];
registro.logger = registro.crearLogger({
  destino: new Writable({
    write(trozo, _c, listo) {
      lineasLog.push(...trozo.toString().split("\n").filter(Boolean));
      listo();
    },
  }),
  nivel: "debug",
});

const app = require("../src/app");
const gemini = require("../src/services/geminiService");
const reporteService = require("../src/services/reporteService");
const alertaStockService = require("../src/services/alertaStockService");
const chatbotService = require("../src/services/chatbotService");
const plantillas = require("../src/services/chatbotPlantillas");
const { hoyColombia } = require("../src/utils/fechaColombia");

const firmar = (rol, id) => firmarToken(rol, { id_usuario: id, usuario_login: `${rol}_${id}` });
const JWT = { administrador: firmar("administrador", 1), cajero: firmar("cajero", 2), mesero: firmar("mesero", 3) };

// Todo lo que el servidor respondió en este archivo, para buscar la clave al final.
const respuestasVistas = [];

let servidor;
let base;
test.before(() => {
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});
test.after(() => {
  servidor.close();
  globalThis.fetch = fetchReal;
});

async function pedir(metodo, ruta, { token = JWT.cajero, cuerpo } = {}) {
  const r = await fetchReal(`${base}${ruta}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  respuestasVistas.push(texto);
  return { status: r.status, body: JSON.parse(texto), encabezados: r.headers };
}
const preguntar = (cuerpo, token) => pedir("POST", "/chatbot", { cuerpo, token });

// ---------- Datos fijos (sin base) ----------

const HOY = hoyColombia();
const producto = (id_producto, nombre, unidades, total) => ({ id_producto, nombre, unidades, total });
function reporteFalso(periodo) {
  const rangos = {
    dia: { desde: "2026-10-11", hasta: "2026-10-11" },
    semana: { desde: "2026-10-05", hasta: "2026-10-11" },
    mes: { desde: "2026-10-01", hasta: "2026-10-31" },
    anio: { desde: "2026-01-01", hasta: "2026-12-31" },
  };
  return {
    periodo,
    fecha_referencia: "2026-10-11",
    rango: { ...rangos[periodo], zona_horaria: "America/Bogota" },
    total_vendido: 425000,
    numero_ventas: 3,
    ticket_promedio: 141666.67,
    top_productos: [producto(1, "Ron", 40, 400000), producto(2, "Cerveza", 5, 17500), producto(3, "Hielo", 2, 7500)],
    productos_menos_vendidos: [producto(4, "Papas", 0, 0)],
    movimientos_inventario: {
      entradas: { movimientos: 1, unidades: 24 },
      salidas: { movimientos: 3, unidades: 47 },
      ajustes: { movimientos: 0, unidades: 0 },
    },
    ventas_por_dia:
      periodo === "semana"
        ? [
            { fecha: "2026-10-05", total: 0, numero_ventas: 0 },
            { fecha: "2026-10-08", total: 25000, numero_ventas: 1 },
            { fecha: "2026-10-11", total: 400000, numero_ventas: 2 },
          ]
        : [{ fecha: "2026-10-11", total: 425000, numero_ventas: 3 }],
  };
}
const alerta = (nombre, estado, stock_actual, umbral_alerta, cantidad_sugerida) => ({
  id_producto: 9, nombre, categoria_nombre: "Licores", unidad_medida: "botella", stock_actual, umbral_alerta, estado,
  unidades_vendidas: 30, promedio_diario: 1, dias_cobertura: stock_actual, cantidad_sugerida,
});
const ALERTAS = {
  parametros: { ventana_dias: 30, cobertura_alerta_dias: 5, dias_objetivo: 14, desde: "2026-09-12", hasta: "2026-10-11", zona_horaria: "America/Bogota" },
  resumen: { total: 3, agotado: 1, bajo_minimo: 1, por_agotarse: 1 },
  productos: [
    alerta("Aguardiente", "agotado", 0, 5, 14),
    alerta("Cerveza", "bajo_minimo", 3, 5, 25),
    alerta("Kirsch", "por_agotarse", 4, 1, 10),
  ],
};

// Reemplaza la lógica de datos y registra con qué se llamó. Devuelve la función para restaurar.
function datosFalsos({ reporte = reporteFalso, alertas = ALERTAS } = {}) {
  const originales = { porPeriodo: reporteService.porPeriodo, listar: alertaStockService.listar };
  const llamadas = { reporte: [], alertas: 0 };
  reporteService.porPeriodo = async (args) => {
    llamadas.reporte.push(args);
    return reporte(args.periodo);
  };
  alertaStockService.listar = async () => {
    llamadas.alertas += 1;
    return alertas;
  };
  const restaurar = () => {
    reporteService.porPeriodo = originales.porPeriodo;
    alertaStockService.listar = originales.listar;
  };
  return { llamadas, restaurar };
}

// ---------- Gemini simulado ----------

const respuestaGemini = (parts) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { role: "model", parts } }] }),
});
const textoGemini = (texto) => respuestaGemini([{ text: texto }]);
const llamadaHerramienta = (name, args, id) => ({ functionCall: { name, args, ...(id ? { id } : {}) } });

// Cada llamada a Gemini toma la siguiente respuesta de la lista (objeto o función(opciones)).
function geminiSimulado(respuestas) {
  const llamadas = [];
  gemini.dependencias.fetch = async (url, opciones) => {
    llamadas.push({ url, opciones, cuerpo: JSON.parse(opciones.body) });
    const r = respuestas.shift();
    if (r === undefined) throw new Error("prueba: llamada a Gemini no esperada");
    return typeof r === "function" ? r(opciones) : r;
  };
  return llamadas;
}

function conClave(t, { modelo } = {}) {
  process.env.GEMINI_API_KEY = CLAVE;
  if (modelo) process.env.GEMINI_MODEL = modelo;
  t.after(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    gemini.dependencias.fetch = (...args) => globalThis.fetch(...args);
    gemini.dependencias.timeoutMs = gemini.TIMEOUT_MS;
  });
}

const BASICO = chatbotService.soloPreguntasRapidas();

// ---------- 1) Sin base de datos ----------

test("GET /api/chatbot/preguntas: las 5 preguntas rápidas; administrador y cajero sí, mesero 403, sin token 401", async () => {
  const { status, body } = await pedir("GET", "/chatbot/preguntas", { token: JWT.administrador });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body, {
    preguntas: [
      { id: "ventas_hoy", texto: "¿Qué se vendió hoy?" },
      { id: "ventas_semana", texto: "¿Cómo van las ventas de esta semana?" },
      { id: "mas_vendidos_mes", texto: "¿Cuáles son los más vendidos del mes?" },
      { id: "reabastecer", texto: "¿Qué debo reabastecer?" },
      { id: "agotados", texto: "¿Qué productos están agotados?" },
    ],
  });
  assert.strictEqual((await pedir("GET", "/chatbot/preguntas")).status, 200);
  assert.strictEqual((await pedir("GET", "/chatbot/preguntas", { token: JWT.mesero })).status, 403);
  assert.strictEqual((await pedir("GET", "/chatbot/preguntas", { token: null })).status, 401);
});

test("POST /api/chatbot: permisos (200 / 403 / 401)", async (t) => {
  const { restaurar } = datosFalsos();
  t.after(restaurar);
  assert.strictEqual((await preguntar({ pregunta_id: "agotados" }, JWT.administrador)).status, 200);
  assert.strictEqual((await preguntar({ pregunta_id: "agotados" }, JWT.cajero)).status, 200);
  const mesero = await preguntar({ pregunta_id: "agotados" }, JWT.mesero);
  assert.strictEqual(mesero.status, 403);
  assert.strictEqual((await preguntar({ pregunta_id: "agotados" }, null)).status, 401);
  assert.strictEqual((await preguntar({ pregunta_id: "agotados" }, "token-invalido")).status, 401);
});

test("POST /api/chatbot: validaciones de entrada (400)", async (t) => {
  const { restaurar } = datosFalsos();
  t.after(restaurar);
  const token = firmar("cajero", 101);
  const casos = [
    [{}, "Envía un mensaje o una pregunta rápida (pregunta_id)."],
    [{ mensaje: null }, "Envía un mensaje o una pregunta rápida (pregunta_id)."],
    [{ mensaje: "" }, "El mensaje no puede estar vacío."],
    [{ mensaje: "   \n " }, "El mensaje no puede estar vacío."],
    [{ mensaje: "a".repeat(501) }, "El mensaje no puede superar 500 caracteres."],
    [{ mensaje: 123 }, "mensaje debe ser texto."],
    [{ mensaje: ["hola"] }, "mensaje debe ser texto."],
    [{ mensaje: "hola", pregunta_id: "agotados" }, "Envía un mensaje o una pregunta rápida (pregunta_id), no ambos."],
    [{ pregunta_id: "clima" }, "pregunta_id no es una pregunta rápida válida."],
    [{ pregunta_id: 1 }, "pregunta_id no es una pregunta rápida válida."],
    [{ pregunta_id: "constructor" }, "pregunta_id no es una pregunta rápida válida."],
  ];
  for (const [cuerpo, error] of casos) {
    assert.deepStrictEqual(await preguntar(cuerpo, token).then((r) => [r.status, r.body]), [400, { error }], JSON.stringify(cuerpo).slice(0, 60));
  }
  // 500 caracteres exactos (los espacios de los extremos no cuentan) sí se aceptan.
  const largo = await preguntar({ mensaje: ` ${"é".repeat(500)} ` }, token);
  assert.deepStrictEqual([largo.status, largo.body], [200, { respuesta: BASICO, origen: "basico" }]);
});

test("POST /api/chatbot: máximo 20 mensajes por minuto por usuario (429 con Retry-After)", async (t) => {
  const { restaurar } = datosFalsos();
  t.after(restaurar);
  const token = firmar("cajero", 202);
  for (let i = 0; i < 20; i += 1) {
    assert.strictEqual((await preguntar({ pregunta_id: "agotados" }, token)).status, 200, `mensaje ${i + 1}`);
  }
  const bloqueado = await preguntar({ pregunta_id: "agotados" }, token);
  assert.strictEqual(bloqueado.status, 429);
  assert.deepStrictEqual(bloqueado.body, { error: "Demasiados mensajes al asistente. Espera un minuto e inténtalo de nuevo." });
  const espera = Number(bloqueado.encabezados.get("retry-after"));
  assert.ok(espera >= 1 && espera <= 60);
  // Otro usuario no se ve afectado, y GET /preguntas no cuenta.
  assert.strictEqual((await preguntar({ pregunta_id: "agotados" }, firmar("administrador", 203))).status, 200);
  assert.strictEqual((await pedir("GET", "/chatbot/preguntas", { token })).status, 200);
});

test("plantillas del modo básico con datos fijos (cada pregunta rápida)", async (t) => {
  const { restaurar, llamadas } = datosFalsos();
  t.after(restaurar);
  const token = firmar("administrador", 301);
  const r = async (pregunta_id) => (await preguntar({ pregunta_id }, token)).body;

  assert.deepStrictEqual(await r("ventas_hoy"), {
    origen: "basico",
    respuesta:
      "Hoy (domingo 11 de octubre) se vendieron $ 425.000 en 3 ventas, con un ticket promedio de $ 141.666,67. " +
      "Lo más vendido: Ron (40 unidades), Cerveza (5 unidades) y Hielo (2 unidades).",
  });
  assert.deepStrictEqual(await r("ventas_semana"), {
    origen: "basico",
    respuesta:
      "Esta semana (del lunes 5 al domingo 11 de octubre) van $ 425.000 en 3 ventas, con un ticket promedio de " +
      "$ 141.666,67. El mejor día fue el domingo 11 de octubre, con $ 400.000.",
  });
  assert.deepStrictEqual(await r("mas_vendidos_mes"), {
    origen: "basico",
    respuesta:
      "Los más vendidos de octubre de 2026:\n1. Ron: 40 unidades ($ 400.000)\n2. Cerveza: 5 unidades ($ 17.500)\n" +
      "3. Hielo: 2 unidades ($ 7.500)",
  });
  assert.deepStrictEqual(await r("reabastecer"), {
    origen: "basico",
    respuesta:
      "Te sugiero reabastecer (según las ventas de los últimos 30 días):\n• Aguardiente (agotado, stock 0): pedir 14\n" +
      "• Cerveza (bajo el mínimo, stock 3): pedir 25\n• Kirsch (por agotarse, stock 4): pedir 10",
  });
  assert.deepStrictEqual(await r("agotados"), { origen: "basico", respuesta: "Hay 1 producto agotado: Aguardiente." });
  assert.deepStrictEqual(llamadas.reporte.map((a) => a.periodo), ["dia", "semana", "mes"]);
  assert.strictEqual(llamadas.alertas, 2);
});

test("plantillas sin datos: sin ventas, sin alertas", () => {
  const vacio = { ...reporteFalso("dia"), total_vendido: 0, numero_ventas: 0, ticket_promedio: 0, top_productos: [] };
  assert.strictEqual(plantillas.ventasHoy(vacio), "Hoy (domingo 11 de octubre) todavía no hay ventas registradas.");
  assert.strictEqual(
    plantillas.ventasSemana({ ...vacio, rango: { desde: "2026-09-28", hasta: "2026-10-04" } }),
    "Esta semana (del lunes 28 de septiembre al domingo 4 de octubre) todavía no hay ventas registradas."
  );
  assert.strictEqual(
    plantillas.masVendidosMes({ ...vacio, rango: { desde: "2026-10-01", hasta: "2026-10-31" } }),
    "En octubre de 2026 todavía no hay ventas registradas."
  );
  const sinAlertas = { ...ALERTAS, productos: [] };
  assert.strictEqual(plantillas.reabastecer(sinAlertas), "Todo el stock está en orden: no hay nada que reabastecer por ahora.");
  assert.strictEqual(plantillas.agotados(sinAlertas), "No hay productos agotados.");
  const varios = { ...ALERTAS, productos: ["A", "B", "C"].map((n) => alerta(n, "agotado", 0, 0, 0)) };
  assert.strictEqual(plantillas.agotados(varios), "Hay 3 productos agotados: A, B y C.");
  assert.match(plantillas.reabastecer(varios), /• A \(agotado, stock 0\): sin cantidad sugerida \(pocas ventas recientes\)/);
});

test("texto libre sin GEMINI_API_KEY: modo básico, sin llamar a Gemini", async (t) => {
  const { restaurar } = datosFalsos();
  t.after(restaurar);
  const llamadas = geminiSimulado([]);
  t.after(() => {
    gemini.dependencias.fetch = (...args) => globalThis.fetch(...args);
  });
  const { status, body } = await preguntar({ mensaje: "¿Cuánto vendimos hoy?" }, firmar("cajero", 401));
  assert.deepStrictEqual([status, body], [200, { respuesta: BASICO, origen: "basico" }]);
  assert.strictEqual(llamadas.length, 0);
  assert.match(BASICO, /^Ahora mismo solo puedo responder las preguntas rápidas:\n• ¿Qué se vendió hoy\?/);
});

test("flujo con herramienta simulada: obtener_reporte → texto final de la IA", async (t) => {
  conClave(t);
  const { restaurar, llamadas: datos } = datosFalsos();
  t.after(restaurar);
  const llamadas = geminiSimulado([
    respuestaGemini([{ text: "pensando", thought: true }, { ...llamadaHerramienta("obtener_reporte", { periodo: "dia" }, "c1"), thoughtSignature: "firma" }]),
    textoGemini("Hoy se vendieron $ 425.000 en 3 ventas."),
  ]);
  const token = firmar("cajero", 501);
  const { status, body } = await preguntar({ mensaje: "¿Cuánto vendimos hoy?" }, token);
  assert.deepStrictEqual([status, body], [200, { respuesta: "Hoy se vendieron $ 425.000 en 3 ventas.", origen: "ia" }]);

  // La lógica existente se llamó con el periodo pedido y la fecha de hoy en Colombia.
  assert.deepStrictEqual(datos.reporte, [{ periodo: "dia", fecha: HOY }]);
  assert.strictEqual(llamadas.length, 2);
  const [primera, segunda] = llamadas;
  // Petición: modelo por defecto, clave solo en el encabezado, POST JSON.
  assert.strictEqual(primera.url, `https://generativelanguage.googleapis.com/v1beta/models/${gemini.MODELO_POR_DEFECTO}:generateContent`);
  assert.strictEqual(primera.opciones.method, "POST");
  assert.strictEqual(primera.opciones.headers["x-goog-api-key"], CLAVE);
  assert.ok(!primera.url.includes(CLAVE));
  // Prompt de sistema, herramientas y un solo mensaje (sin historial).
  const prompt = primera.cuerpo.systemInstruction.parts[0].text;
  assert.match(prompt, /asistente de inventario de una licorería/);
  assert.match(prompt, /SOLO con datos devueltos por las herramientas/);
  assert.match(prompt, /no inventes|Nunca inventes/i);
  assert.match(prompt, /solo ayudas con ventas e inventario/);
  assert.deepStrictEqual(primera.cuerpo.tools[0].functionDeclarations.map((f) => f.name), ["obtener_reporte", "obtener_alertas_stock"]);
  assert.deepStrictEqual(primera.cuerpo.contents, [{ role: "user", parts: [{ text: "¿Cuánto vendimos hoy?" }] }]);
  // Segunda llamada: el turno del modelo tal cual (con su firma) y la respuesta de la herramienta.
  assert.strictEqual(segunda.cuerpo.contents.length, 3);
  assert.strictEqual(segunda.cuerpo.contents[1].role, "model");
  assert.strictEqual(segunda.cuerpo.contents[1].parts[1].thoughtSignature, "firma");
  const respuestaHerramienta = segunda.cuerpo.contents[2].parts[0].functionResponse;
  assert.strictEqual(respuestaHerramienta.id, "c1");
  assert.strictEqual(respuestaHerramienta.name, "obtener_reporte");
  assert.strictEqual(respuestaHerramienta.response.total_vendido_texto, "$ 425.000");
  assert.strictEqual(respuestaHerramienta.response.mas_vendidos[0].nombre, "Ron");
  // Nada de datos de usuarios, tokens ni la clave en lo que se envía a Gemini.
  for (const { opciones } of llamadas) {
    for (const prohibido of [CLAVE, token, "cajero_501", "id_usuario", "password", "usuario_login"]) {
      assert.ok(!opciones.body.includes(prohibido), `el cuerpo enviado a Gemini incluye ${prohibido}`);
    }
  }
});

test("herramientas: argumentos inválidos de Gemini no llegan a la lógica; alertas sin parámetros", async (t) => {
  conClave(t);
  const { restaurar, llamadas: datos } = datosFalsos();
  t.after(restaurar);
  const llamadas = geminiSimulado([
    respuestaGemini([
      llamadaHerramienta("obtener_reporte", { periodo: "trimestre" }),
      llamadaHerramienta("obtener_reporte", { periodo: "dia", fecha: "2999-01-01" }),
      llamadaHerramienta("obtener_reporte", { periodo: "mes", fecha: "2026-02-30" }),
      llamadaHerramienta("obtener_reporte", "no es un objeto"),
      llamadaHerramienta("borrar_todo", {}),
      llamadaHerramienta("obtener_alertas_stock", { ventana_dias: 9999 }),
    ]),
    textoGemini("Hay 3 productos en alerta."),
  ]);
  const { body } = await preguntar({ mensaje: "¿Qué debo pedir?" }, firmar("administrador", 601));
  assert.deepStrictEqual(body, { respuesta: "Hay 3 productos en alerta.", origen: "ia" });
  assert.deepStrictEqual(datos.reporte, []);
  assert.strictEqual(datos.alertas, 1);
  const respuestas = llamadas[1].cuerpo.contents[2].parts.map((p) => p.functionResponse.response);
  assert.deepStrictEqual(respuestas.slice(0, 5), [
    { error: "periodo inválido: debe ser uno de dia, semana, mes, anio." },
    { error: "fecha futura: no hay datos de fechas posteriores a hoy." },
    { error: "fecha inválida: debe ser AAAA-MM-DD." },
    { error: "periodo inválido: debe ser uno de dia, semana, mes, anio." },
    { error: "herramienta desconocida." },
  ]);
  assert.strictEqual(respuestas[5].ventana_dias, 30);
  assert.deepStrictEqual(respuestas[5].productos[0], {
    nombre: "Aguardiente", estado: "agotado", stock_actual: 0, stock_minimo: 5,
    unidades_vendidas_en_ventana: 30, dias_cobertura: 0, cantidad_sugerida: 14,
  });
});

test("GEMINI_MODEL configurable; un nombre de modelo raro cae al modo básico sin llamar", async (t) => {
  conClave(t, { modelo: "gemini-prueba-1.0" });
  const llamadas = geminiSimulado([textoGemini("Solo ayudo con ventas e inventario.")]);
  const ok = await preguntar({ mensaje: "¿Qué clima hace?" }, firmar("cajero", 701));
  assert.deepStrictEqual(ok.body, { respuesta: "Solo ayudo con ventas e inventario.", origen: "ia" });
  assert.match(llamadas[0].url, /\/models\/gemini-prueba-1\.0:generateContent$/);

  process.env.GEMINI_MODEL = "../otra/ruta?key=x";
  const raro = await preguntar({ mensaje: "hola" }, firmar("cajero", 702));
  assert.deepStrictEqual(raro.body, { respuesta: BASICO, origen: "basico" });
  assert.strictEqual(llamadas.length, 1);
});

test("caída al modo básico: error HTTP, error de red, timeout, respuesta inválida, texto vacío, demasiadas herramientas", async (t) => {
  conClave(t);
  const { restaurar } = datosFalsos();
  t.after(restaurar);
  gemini.dependencias.timeoutMs = 50;
  const lento = (opciones) =>
    new Promise((_resolver, rechazar) => {
      opciones.signal.addEventListener("abort", () => rechazar(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  const herramienta = () => respuestaGemini([llamadaHerramienta("obtener_alertas_stock", {})]);
  const casos = [
    ["http_500", [{ ok: false, status: 500, json: async () => ({ error: { message: `clave ${CLAVE} inválida` } }) }], 1],
    ["http_429", [{ ok: false, status: 429, json: async () => ({}) }], 1],
    ["red", [() => Promise.reject(new Error(`ECONNRESET ${CLAVE}`))], 1],
    ["timeout", [lento], 1],
    ["respuesta_invalida (sin candidates)", [{ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) }], 1],
    ["respuesta_invalida (JSON roto)", [{ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } }], 1],
    ["respuesta_invalida (texto vacío)", [textoGemini("   ")], 1],
    ["respuesta_invalida (solo razonamiento)", [respuestaGemini([{ text: "interno", thought: true }])], 1],
    ["respuesta_invalida (texto enorme)", [textoGemini("x".repeat(4001))], 1],
    ["demasiadas_herramientas", [herramienta(), herramienta(), herramienta(), herramienta()], 4],
  ];
  let id = 800;
  for (const [nombre, respuestas, esperadas] of casos) {
    const llamadas = geminiSimulado([...respuestas]);
    const inicio = Date.now();
    const { status, body } = await preguntar({ mensaje: "¿Cómo vamos?" }, firmar("cajero", (id += 1)));
    assert.deepStrictEqual([status, body], [200, { respuesta: BASICO, origen: "basico" }], nombre);
    assert.strictEqual(llamadas.length, esperadas, `${nombre}: llamadas a Gemini`);
    assert.ok(Date.now() - inicio < 5000, `${nombre}: tardó demasiado`);
  }
  // Exactamente 3 rondas de herramientas sí se permiten.
  geminiSimulado([herramienta(), herramienta(), herramienta(), textoGemini("Listo.")]);
  assert.deepStrictEqual((await preguntar({ mensaje: "¿Qué pido?" }, firmar("cajero", 899))).body, { respuesta: "Listo.", origen: "ia" });

  // El log tiene el motivo de cada caída y nada más.
  const motivos = lineasLog.map((l) => JSON.parse(l)).filter((l) => l.msg === "chatbot: Gemini no disponible, modo básico").map((l) => l.motivo);
  for (const m of ["http_500", "http_429", "red", "timeout", "respuesta_invalida", "demasiadas_herramientas"]) {
    assert.ok(motivos.includes(m), `falta el motivo ${m} en el log`);
  }
});

test("la caída al modo básico no expone la clave ni el mensaje en el log", () => {
  assert.ok(lineasLog.length > 0);
  for (const linea of lineasLog) {
    assert.ok(!linea.includes(CLAVE), "la clave apareció en el log");
    assert.ok(!linea.includes("¿Cómo vamos?"), "el mensaje del usuario apareció en el log");
  }
  for (const r of respuestasVistas) assert.ok(!r.includes(CLAVE), "la clave apareció en una respuesta");
  assert.strictEqual(intentosGoogle, 0, "se intentó llamar al Gemini real");
});

// ---------- 2) Integración con datos de prueba ----------

test("integración: cada pregunta rápida con datos de prueba en la base local", { skip: !BASE_LOCAL && "sin PRUEBA_DATABASE_URL local" }, async (t) => {
  const db = require("../src/db/db");
  await db.inicializarEsquema();
  const { n } = await db.uno("SELECT COUNT(*) AS n FROM productos");
  if (n > 0) {
    await db.pool.end();
    t.skip("la base ya tiene productos: se necesita una base recién creada");
    return;
  }
  t.after(() => db.pool.end());

  const { id_usuario } = await db.uno(
    "INSERT INTO usuarios (nombre, usuario_login, password_hash, rol) VALUES ('Cajero chatbot', 'cajero_chatbot', 'x', 'cajero') RETURNING id_usuario"
  );
  const { id_categoria } = await db.uno("INSERT INTO categorias (nombre) VALUES ('Licores') RETURNING id_categoria");
  const producto = async (nombre, precio, stock, umbral) =>
    (await db.uno(
      `INSERT INTO productos (id_categoria, nombre, unidad_medida, precio, stock_actual, umbral_alerta)
       VALUES ($1, $2, 'botella', $3, $4, $5) RETURNING id_producto`,
      [id_categoria, nombre, precio, stock, umbral]
    )).id_producto;
  const ron = await producto("Ron", 10000, 4, 1); // 40 vendidas hoy → por agotarse
  const cerveza = await producto("Cerveza", 3500, 3, 5); // bajo el mínimo
  const aguardiente = await producto("Aguardiente", 45000, 0, 5); // agotado sin ventas
  await producto("Papas", 2500, 100, 5); // en orden

  // Ventas de hoy (fecha_hora por defecto = ahora en UTC); la anulada no cuenta.
  const venta = async (lineas, estado = "activa") => {
    const total = lineas.reduce((s, [, c, p]) => s + c * p, 0);
    const { id_venta } = await db.uno(
      "INSERT INTO ventas (tipo, id_usuario, total, estado) VALUES ('mostrador', $1, $2, $3) RETURNING id_venta",
      [id_usuario, total, estado]
    );
    for (const [id, c, p] of lineas) {
      await db.ejecutar("INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)", [id_venta, id, c, p]);
    }
  };
  await venta([[ron, 25, 10000], [cerveza, 5, 3500]]); // 267500
  await venta([[ron, 15, 10000]]); // 150000
  await venta([[aguardiente, 100, 45000]], "anulada");

  // Usuario real de la base: pasa por la consulta real de auth.js.
  const token = jwt.sign({ id_usuario, usuario_login: "cajero_chatbot", rol: "cajero" }, process.env.JWT_SECRET);
  const r = async (pregunta_id) => {
    const { status, body } = await preguntar({ pregunta_id }, token);
    assert.strictEqual(status, 200, pregunta_id);
    assert.strictEqual(body.origen, "basico");
    return body.respuesta;
  };

  assert.strictEqual(
    await r("ventas_hoy"),
    `Hoy (${plantillas.textoDia(HOY)}) se vendieron $ 417.500 en 2 ventas, con un ticket promedio de $ 208.750. ` +
      "Lo más vendido: Ron (40 unidades) y Cerveza (5 unidades)."
  );
  const semana = await r("ventas_semana");
  assert.match(semana, /^Esta semana \(del .+\) van \$ 417\.500 en 2 ventas, con un ticket promedio de \$ 208\.750\. El mejor día fue el .+, con \$ 417\.500\.$/);
  assert.strictEqual(
    await r("mas_vendidos_mes"),
    `Los más vendidos de ${plantillas.textoMes(HOY)}:\n1. Ron: 40 unidades ($ 400.000)\n2. Cerveza: 5 unidades ($ 17.500)`
  );
  assert.strictEqual(
    await r("reabastecer"),
    "Te sugiero reabastecer (según las ventas de los últimos 30 días):\n" +
      "• Aguardiente (agotado, stock 0): pedir 10\n" + // sin ventas: 5 × 2 − 0
      "• Cerveza (bajo el mínimo, stock 3): sin cantidad sugerida (pocas ventas recientes)\n" + // ceil(5 × 14 / 30 − 3) < 0 → 0
      "• Ron (por agotarse, stock 4): pedir 15"
  );
  assert.strictEqual(await r("agotados"), "Hay 1 producto agotado: Aguardiente.");
});
