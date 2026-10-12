// Chatbot del personal: responde sobre ventas, más vendidos y reabastecimiento.
//
// Regla de oro: la IA solo redacta. Todas las cifras salen de reporteService y
// alertaStockService (la misma lógica de GET /api/reportes y /api/alertas-stock,
// llamada directo, sin HTTP).
//
// - pregunta_id: plantilla de texto con los datos, sin IA (origen "basico").
// - mensaje libre: Gemini con function calling (obtener_reporte,
//   obtener_alertas_stock), máximo 3 rondas de herramientas. Si no hay clave,
//   Gemini falla, tarda más de 20 s o responde algo inválido, nunca hay error:
//   se responde en modo básico con la lista de preguntas rápidas.
// - A Gemini solo van el mensaje del usuario, el prompt y datos agregados de
//   reportes y alertas (nombres de productos, cantidades y totales). Nunca
//   datos de usuarios, contraseñas, tokens ni clientes. Sin historial: cada
//   mensaje es independiente.
// - Log: solo el motivo de la caída al modo básico; nunca el mensaje, la
//   respuesta ni la clave.

const reporteService = require("./reporteService");
const alertaStockService = require("./alertaStockService");
const gemini = require("./geminiService");
const plantillas = require("./chatbotPlantillas");
const { PERIODOS, leerFecha } = require("../utils/periodoReporte");
const { hoyColombia } = require("../utils/fechaColombia");
const { ErrorValidacion } = require("../utils/errores");
const registro = require("../utils/logger");

const MAXIMO_CARACTERES = 500;
const MAXIMO_RONDAS_HERRAMIENTAS = 3;
const MAXIMO_RESPUESTA = 4000;

// ---------- Preguntas rápidas (modo básico) ----------

const PREGUNTAS = [
  { id: "ventas_hoy", texto: "¿Qué se vendió hoy?" },
  { id: "ventas_semana", texto: "¿Cómo van las ventas de esta semana?" },
  { id: "mas_vendidos_mes", texto: "¿Cuáles son los más vendidos del mes?" },
  { id: "reabastecer", texto: "¿Qué debo reabastecer?" },
  { id: "agotados", texto: "¿Qué productos están agotados?" },
];

const RESPUESTAS_RAPIDAS = {
  ventas_hoy: async () => plantillas.ventasHoy(await reporteService.porPeriodo({ periodo: "dia" })),
  ventas_semana: async () => plantillas.ventasSemana(await reporteService.porPeriodo({ periodo: "semana" })),
  mas_vendidos_mes: async () => plantillas.masVendidosMes(await reporteService.porPeriodo({ periodo: "mes" })),
  reabastecer: async () => plantillas.reabastecer(await alertaStockService.listar({})),
  agotados: async () => plantillas.agotados(await alertaStockService.listar({})),
};

function soloPreguntasRapidas() {
  return `Ahora mismo solo puedo responder las preguntas rápidas:\n${PREGUNTAS.map((p) => `• ${p.texto}`).join("\n")}`;
}

// ---------- Herramientas para Gemini ----------

const HERRAMIENTAS = [
  {
    functionDeclarations: [
      {
        name: "obtener_reporte",
        description:
          "Ventas de un periodo (día, semana de lunes a domingo, mes o año) que contiene la fecha dada: total vendido, " +
          "número de ventas, ticket promedio, productos más y menos vendidos, movimientos de inventario y ventas por día. " +
          "Sin ventas anuladas. Fechas de Colombia.",
        parameters: {
          type: "OBJECT",
          properties: {
            periodo: { type: "STRING", enum: PERIODOS, description: "dia, semana, mes o anio" },
            fecha: {
              type: "STRING",
              description: "Fecha de referencia AAAA-MM-DD (opcional; por defecto hoy). No puede ser futura.",
            },
          },
          required: ["periodo"],
        },
      },
      {
        name: "obtener_alertas_stock",
        description:
          "Productos activos agotados, bajo el mínimo o por agotarse según las ventas de los últimos 30 días, con stock " +
          "actual, mínimo, días de cobertura y cantidad sugerida a pedir.",
        // Sin parámetros: usa los valores por defecto del endpoint.
      },
    ],
  },
];

function promptSistema(hoy) {
  return [
    "Eres el asistente de inventario de una licorería en Colombia y hablas con el personal (administrador o cajero).",
    `Hoy es ${plantillas.textoDia(hoy)} de ${hoy.slice(0, 4)} (${hoy}, hora de Colombia).`,
    "Responde SOLO con datos devueltos por las herramientas obtener_reporte y obtener_alertas_stock.",
    "Si no tienes el dato, dilo con claridad. Nunca inventes ni calcules cifras que no estén en las herramientas.",
    "Usa los campos *_texto para el dinero: pesos colombianos con punto de miles, por ejemplo $ 425.000.",
    "Respuestas cortas y claras, en español, sin markdown complejo (como mucho viñetas con •).",
    "Si preguntan algo ajeno a las ventas o el inventario de la licorería, indica que solo ayudas con ventas e inventario.",
  ].join("\n");
}

// Datos agregados que recibe Gemini: solo lo necesario, con el dinero ya formateado.
const producto = (p) => ({ nombre: p.nombre, unidades: p.unidades, total: p.total, total_texto: plantillas.pesos(p.total) });

function resumenReporte(r) {
  return {
    periodo: r.periodo,
    desde: r.rango.desde,
    hasta: r.rango.hasta,
    total_vendido: r.total_vendido,
    total_vendido_texto: plantillas.pesos(r.total_vendido),
    numero_ventas: r.numero_ventas,
    ticket_promedio: r.ticket_promedio,
    ticket_promedio_texto: plantillas.pesos(r.ticket_promedio),
    mas_vendidos: r.top_productos.map(producto),
    menos_vendidos: r.productos_menos_vendidos.map(producto),
    movimientos_inventario: r.movimientos_inventario,
    // Solo los días con ventas (el año trae 365 puntos).
    dias_con_ventas: r.ventas_por_dia
      .filter((d) => d.numero_ventas > 0)
      .map((d) => ({ fecha: d.fecha, total: d.total, total_texto: plantillas.pesos(d.total), numero_ventas: d.numero_ventas })),
  };
}

function resumenAlertas(a) {
  return {
    ventana_dias: a.parametros.ventana_dias,
    cobertura_alerta_dias: a.parametros.cobertura_alerta_dias,
    dias_objetivo: a.parametros.dias_objetivo,
    resumen: a.resumen,
    productos: a.productos.map((p) => ({
      nombre: p.nombre,
      estado: p.estado,
      stock_actual: p.stock_actual,
      stock_minimo: p.umbral_alerta,
      unidades_vendidas_en_ventana: p.unidades_vendidas,
      dias_cobertura: p.dias_cobertura,
      cantidad_sugerida: p.cantidad_sugerida,
    })),
  };
}

// Valida los argumentos que envía Gemini y ejecuta la lógica existente. Un
// argumento inválido no llega a la base: vuelve a Gemini como { error }, y el
// prompt le exige decir que no tiene el dato.
async function ejecutarHerramienta(nombre, args, hoy) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  if (nombre === "obtener_reporte") {
    if (!PERIODOS.includes(a.periodo)) {
      return { error: `periodo inválido: debe ser uno de ${PERIODOS.join(", ")}.` };
    }
    let fecha;
    if (a.fecha !== undefined && a.fecha !== null && a.fecha !== "") {
      if (typeof a.fecha !== "string" || !leerFecha(a.fecha)) return { error: "fecha inválida: debe ser AAAA-MM-DD." };
      if (a.fecha > hoy) return { error: "fecha futura: no hay datos de fechas posteriores a hoy." };
      fecha = a.fecha;
    }
    return resumenReporte(await reporteService.porPeriodo({ periodo: a.periodo, fecha: fecha || hoy }));
  }
  if (nombre === "obtener_alertas_stock") {
    // Sin parámetros: los valores por defecto del endpoint.
    return resumenAlertas(await alertaStockService.listar({}, hoy));
  }
  return { error: "herramienta desconocida." };
}

class RespuestaInvalida extends gemini.ErrorGemini {}

async function responderConIA(mensaje, hoy) {
  const contents = [{ role: "user", parts: [{ text: mensaje }] }];
  const cuerpo = () => ({
    systemInstruction: { parts: [{ text: promptSistema(hoy) }] },
    contents,
    tools: HERRAMIENTAS,
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
  });

  for (let ronda = 0; ; ronda += 1) {
    const contenido = await gemini.generar(cuerpo());
    const llamadas = contenido.parts.filter((p) => p && p.functionCall && typeof p.functionCall.name === "string");
    if (llamadas.length > 0) {
      if (ronda >= MAXIMO_RONDAS_HERRAMIENTAS) throw new RespuestaInvalida("demasiadas_herramientas");
      const respuestas = [];
      for (const { functionCall } of llamadas) {
        const resultado = await ejecutarHerramienta(functionCall.name, functionCall.args, hoy);
        respuestas.push({
          functionResponse: {
            ...(functionCall.id ? { id: functionCall.id } : {}),
            name: functionCall.name,
            response: resultado,
          },
        });
      }
      // El turno del modelo vuelve tal cual (con sus thoughtSignature) y después las respuestas.
      contents.push({ role: "model", parts: contenido.parts });
      contents.push({ role: "user", parts: respuestas });
      continue;
    }
    // Texto final: solo partes de texto que no sean razonamiento interno.
    const texto = contenido.parts
      .filter((p) => p && typeof p.text === "string" && p.thought !== true)
      .map((p) => p.text)
      .join("")
      .trim();
    if (!texto || texto.length > MAXIMO_RESPUESTA) throw new RespuestaInvalida("respuesta_invalida");
    return texto;
  }
}

// ---------- Entrada ----------

function validar(cuerpo) {
  const c = cuerpo && typeof cuerpo === "object" ? cuerpo : {};
  const tieneMensaje = c.mensaje !== undefined && c.mensaje !== null;
  const tienePregunta = c.pregunta_id !== undefined && c.pregunta_id !== null;
  if (tieneMensaje && tienePregunta) {
    throw new ErrorValidacion("Envía un mensaje o una pregunta rápida (pregunta_id), no ambos.");
  }
  if (tienePregunta) {
    if (typeof c.pregunta_id !== "string" || !Object.hasOwn(RESPUESTAS_RAPIDAS, c.pregunta_id)) {
      throw new ErrorValidacion("pregunta_id no es una pregunta rápida válida.");
    }
    return { pregunta_id: c.pregunta_id };
  }
  if (!tieneMensaje) throw new ErrorValidacion("Envía un mensaje o una pregunta rápida (pregunta_id).");
  if (typeof c.mensaje !== "string") throw new ErrorValidacion("mensaje debe ser texto.");
  const mensaje = c.mensaje.trim();
  if (!mensaje) throw new ErrorValidacion("El mensaje no puede estar vacío.");
  if ([...mensaje].length > MAXIMO_CARACTERES) {
    throw new ErrorValidacion(`El mensaje no puede superar ${MAXIMO_CARACTERES} caracteres.`);
  }
  return { mensaje };
}

async function responder(cuerpo) {
  const entrada = validar(cuerpo);
  if (entrada.pregunta_id) {
    return { respuesta: await RESPUESTAS_RAPIDAS[entrada.pregunta_id](), origen: "basico" };
  }
  try {
    return { respuesta: await responderConIA(entrada.mensaje, hoyColombia()), origen: "ia" };
  } catch (err) {
    // Sin clave, timeout, error HTTP, respuesta inválida o una falla al leer los
    // datos: nunca un error para el usuario. Solo el motivo va al log.
    const motivo = err instanceof gemini.ErrorGemini ? err.motivo : "error_interno";
    if (motivo !== "sin_clave") {
      registro.logger.warn({ motivo, tipo: err && err.name }, "chatbot: Gemini no disponible, modo básico");
    }
    return { respuesta: soloPreguntasRapidas(), origen: "basico" };
  }
}

function preguntas() {
  return PREGUNTAS.map((p) => ({ ...p }));
}

module.exports = {
  responder,
  preguntas,
  validar,
  ejecutarHerramienta,
  promptSistema,
  soloPreguntasRapidas,
  HERRAMIENTAS,
  PREGUNTAS,
  MAXIMO_CARACTERES,
  MAXIMO_RONDAS_HERRAMIENTAS,
};
