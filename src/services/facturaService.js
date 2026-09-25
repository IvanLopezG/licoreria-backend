const facturaModel = require("../models/facturaModel");
const emisorModel = require("../models/emisorModel");
const { TIPOS_CONSUMO } = require("../utils/impuestos");

const FORMAS_PAGO = ["efectivo", "tarjeta_debito", "tarjeta_credito", "transferencia"];
const TIPOS_DOC = ["CC", "NIT", "CE", "PP"];

function errorValidacion(mensaje) {
  const err = new Error(mensaje);
  err.status = 400;
  return err;
}

function texto(valor) {
  if (valor === undefined || valor === null) return null;
  const limpio = String(valor).trim();
  return limpio === "" ? null : limpio;
}

// Valida los datos de facturación que llegan al cobrar (cierre de mesa o venta
// de mostrador). Todos son opcionales para no romper a los clientes que aún no
// los envían: por defecto efectivo, "Consumidor Final" y el tipo de consumo
// que corresponde al tipo de venta (mesa → en el sitio, mostrador → para llevar).
function validarDatosFactura(body, tipoVenta) {
  const { forma_pago, tipo_consumo, cliente } = body || {};

  const forma = forma_pago === undefined || forma_pago === null ? "efectivo" : forma_pago;
  if (!FORMAS_PAGO.includes(forma)) {
    throw errorValidacion(`forma_pago debe ser una de: ${FORMAS_PAGO.join(", ")}.`);
  }

  const consumo = tipo_consumo ?? (tipoVenta === "mesa" ? "en_sitio" : "para_llevar");
  if (!TIPOS_CONSUMO.includes(consumo)) {
    throw errorValidacion(`tipo_consumo debe ser una de: ${TIPOS_CONSUMO.join(", ")}.`);
  }

  const nombre = texto(cliente?.nombre);
  const tipo_doc = texto(cliente?.tipo_doc)?.toUpperCase() ?? null;
  const num_doc = texto(cliente?.num_doc);
  const dv = texto(cliente?.dv);

  if ((tipo_doc || num_doc) && !(tipo_doc && num_doc)) {
    throw errorValidacion("cliente.tipo_doc y cliente.num_doc van juntos.");
  }
  if (tipo_doc && !TIPOS_DOC.includes(tipo_doc)) {
    throw errorValidacion(`cliente.tipo_doc debe ser uno de: ${TIPOS_DOC.join(", ")}.`);
  }
  if (num_doc && !nombre) {
    throw errorValidacion("Si el cliente se identifica, cliente.nombre es obligatorio.");
  }
  if (dv && tipo_doc !== "NIT") {
    throw errorValidacion("cliente.dv solo aplica cuando tipo_doc es NIT.");
  }

  return {
    forma_pago: forma,
    tipo_consumo: consumo,
    cliente: { nombre: nombre || "Consumidor Final", tipo_doc, num_doc, dv },
  };
}

function listarFacturas({ desde, hasta }) {
  return facturaModel.listar({ desde, hasta });
}

function obtenerFactura(id_factura) {
  const factura = facturaModel.buscarPorId(id_factura);
  if (!factura) {
    const err = new Error("Factura no encontrada.");
    err.status = 404;
    throw err;
  }
  return factura;
}

const MOTIVO_MINIMO = 10;

function anularFactura(id_factura, { motivo, reabrir_pedidos } = {}, id_usuario) {
  const limpio = texto(motivo);
  if (!limpio || limpio.length < MOTIVO_MINIMO) {
    throw errorValidacion(`El motivo de anulación es obligatorio (mínimo ${MOTIVO_MINIMO} caracteres).`);
  }
  if (reabrir_pedidos !== undefined && typeof reabrir_pedidos !== "boolean") {
    throw errorValidacion("reabrir_pedidos debe ser true o false.");
  }
  return facturaModel.anular({ id_factura, id_usuario, motivo: limpio, reabrir_pedidos: reabrir_pedidos === true });
}

function obtenerEmisor() {
  return emisorModel.obtener();
}

const OBLIGATORIOS_EMISOR = ["razon_social", "nit", "dv", "direccion", "municipio", "departamento", "regimen", "titulo_documento", "leyenda_pie"];

// Edición parcial: los campos que no llegan conservan su valor actual.
function editarEmisor(body) {
  const actual = emisorModel.obtener();
  const datos = {};
  for (const campo of emisorModel.CAMPOS) {
    datos[campo] = body[campo] === undefined ? actual[campo] : texto(body[campo]);
  }
  const faltantes = OBLIGATORIOS_EMISOR.filter((c) => !datos[c]);
  if (faltantes.length > 0) {
    throw errorValidacion(`Campos obligatorios vacíos: ${faltantes.join(", ")}.`);
  }
  return emisorModel.editar(datos);
}

// Datos iniciales del emisor (desde .env, o marcadores para completar luego con
// PUT /api/emisor) y la secuencia interna de numeración. Solo crea lo que falta.
function asegurarDatosIniciales() {
  if (!emisorModel.obtener()) {
    const env = process.env;
    emisorModel.crear({
      razon_social: env.EMISOR_RAZON_SOCIAL || "(Configurar razón social)",
      nit: env.EMISOR_NIT || "000000000",
      dv: env.EMISOR_DV || "0",
      direccion: env.EMISOR_DIRECCION || "(Configurar dirección)",
      municipio: "Floridablanca",
      departamento: "Santander",
      telefono: env.EMISOR_TELEFONO || null,
      regimen: env.EMISOR_REGIMEN || "Régimen Simple de Tributación - SIMPLE",
      titulo_documento: "Comprobante de venta",
      leyenda_pie:
        "Documento interno de venta. No es factura electrónica de venta ni documento equivalente " +
        "validado por la DIAN. Precios con impuestos incluidos.",
    });
  }
  facturaModel.asegurarSecuenciaInicial();
}

module.exports = {
  validarDatosFactura,
  listarFacturas,
  obtenerFactura,
  anularFactura,
  obtenerEmisor,
  editarEmisor,
  asegurarDatosIniciales,
};
