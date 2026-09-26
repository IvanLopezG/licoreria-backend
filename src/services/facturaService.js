const facturaModel = require("../models/facturaModel");
const emisorModel = require("../models/emisorModel");
const facturaElectronicaModel = require("../models/facturaElectronicaModel");
const proveedorTecnologicoService = require("./proveedorTecnologicoService");
const { TIPOS_CONSUMO } = require("../utils/impuestos");
const { normalizarNit, esNitValido, calcularDv } = require("../utils/nit");

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

const esCorreoValido = (correo) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);

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
  // Solo nombre, documento y correo: la ley no permite exigir el RUT ni otro
  // documento al comprador. El correo es obligatorio en factura electrónica
  // si el cliente se identifica (lo valida facturaModel.emitir, que conoce el modo).
  const correo = texto(cliente?.correo);
  if (correo && !esCorreoValido(correo)) {
    throw errorValidacion("cliente.correo no es un correo electrónico válido.");
  }

  return {
    forma_pago: forma,
    tipo_consumo: consumo,
    cliente: { nombre: nombre || "Consumidor Final", tipo_doc, num_doc, dv, correo },
  };
}

function listarFacturas({ desde, hasta }) {
  return facturaModel.listar({ desde, hasta });
}

async function obtenerFactura(id_factura) {
  const factura = await facturaModel.buscarPorId(id_factura);
  if (!factura) {
    const err = new Error("Factura no encontrada.");
    err.status = 404;
    throw err;
  }
  return factura;
}

function errorNoElectronica() {
  const err = new Error("Esta factura no se emitió como factura electrónica.");
  err.status = 404;
  return err;
}

async function obtenerXml(id_factura) {
  const factura = await obtenerFactura(id_factura);
  const xml = await facturaElectronicaModel.obtenerXml(id_factura);
  if (!xml) throw errorNoElectronica();
  return { numero_completo: factura.numero_completo, xml };
}

async function transmitirFactura(id_factura) {
  const factura = await obtenerFactura(id_factura);
  if (!factura.electronica) throw errorNoElectronica();
  return proveedorTecnologicoService.transmitir(factura, factura.electronica, await emisorModel.obtener());
}

const MOTIVO_MINIMO = 10;

async function anularFactura(id_factura, { motivo, reabrir_pedidos } = {}, id_usuario) {
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

// "FACTURA DE VENTA" solo debe usarse con resolución de facturación de la DIAN.
const TITULOS_DOCUMENTO = ["Comprobante de venta", "FACTURA DE VENTA"];

const OBLIGATORIOS_EMISOR = ["razon_social", "nit", "dv", "direccion", "municipio", "departamento", "regimen", "titulo_documento", "leyenda_pie"];

const MODOS_FACTURACION = ["interno", "electronica_dian"];
const AMBIENTES_DIAN = ["pruebas", "produccion"];
const TIPOS_PERSONA = ["natural", "juridica"];
const BANDERAS_EMISOR = ["responsable_iva", "responsable_inc"];

// "(pendiente)" es el marcador de un dato que el dueño aún no ha llenado.
const PENDIENTE = "(pendiente)";
const lleno = (valor) => Boolean(valor) && valor !== PENDIENTE;

// Banderas 0/1 (la app y la base usan 0/1); también acepta true/false.
function bandera(valor, campo) {
  if (valor === true || valor === 1) return 1;
  if (valor === false || valor === 0) return 0;
  throw errorValidacion(`${campo} debe ser 0 o 1.`);
}

// Lo mínimo para operar en modo electrónico. El certificado no se exige: con
// un proveedor tecnológico, normalmente firma el proveedor.
async function validarModoElectronico(datos) {
  const faltantes = [];
  if (!lleno(datos.correo_electronico)) faltantes.push("correo_electronico");
  if (!datos.tipo_persona) faltantes.push("tipo_persona");
  if (!lleno(datos.proveedor_tecnologico)) faltantes.push("proveedor_tecnologico");
  if (faltantes.length > 0) {
    throw errorValidacion(`Para activar la factura electrónica faltan: ${faltantes.join(", ")}.`);
  }
  if (datos.ambiente_dian === "produccion") {
    const secuencia = await facturaModel.secuenciaActiva();
    if (!secuencia?.resolucion_numero || !secuencia?.clave_tecnica) {
      throw errorValidacion(
        "Para facturar en producción, la secuencia activa necesita resolución de numeración y clave técnica de la DIAN."
      );
    }
  }
}

// Edición parcial: los campos que no llegan conservan su valor actual.
async function editarEmisor(body) {
  const actual = await emisorModel.obtener();
  const datos = {};
  for (const campo of emisorModel.CAMPOS) {
    if (body[campo] === undefined) datos[campo] = actual[campo];
    else if (BANDERAS_EMISOR.includes(campo)) datos[campo] = bandera(body[campo], campo);
    else datos[campo] = texto(body[campo]);
  }
  const faltantes = OBLIGATORIOS_EMISOR.filter((c) => !datos[c] && c !== "dv");
  if (faltantes.length > 0) {
    throw errorValidacion(`Campos obligatorios vacíos: ${faltantes.join(", ")}.`);
  }

  // El DV nunca se toma del cliente: se calcula del NIT. Si llega uno distinto,
  // se rechaza en vez de ignorarlo, para no ocultar un NIT mal digitado.
  datos.nit = normalizarNit(datos.nit);
  if (!esNitValido(datos.nit)) {
    throw errorValidacion("El NIT debe tener entre 5 y 15 dígitos (sin el DV).");
  }
  const dv = calcularDv(datos.nit);
  if (body.dv !== undefined && body.dv !== null && String(body.dv).trim() !== "" && String(body.dv).trim() !== dv) {
    throw errorValidacion(`El DV no corresponde a este NIT (el correcto es ${dv}).`);
  }
  datos.dv = dv;

  if (!TITULOS_DOCUMENTO.includes(datos.titulo_documento)) {
    throw errorValidacion(`titulo_documento debe ser: ${TITULOS_DOCUMENTO.join(" o ")}.`);
  }

  if (!MODOS_FACTURACION.includes(datos.modo_facturacion)) {
    throw errorValidacion(`modo_facturacion debe ser: ${MODOS_FACTURACION.join(" o ")}.`);
  }
  if (!AMBIENTES_DIAN.includes(datos.ambiente_dian)) {
    throw errorValidacion(`ambiente_dian debe ser: ${AMBIENTES_DIAN.join(" o ")}.`);
  }
  if (datos.tipo_persona !== null && !TIPOS_PERSONA.includes(datos.tipo_persona)) {
    throw errorValidacion(`tipo_persona debe ser: ${TIPOS_PERSONA.join(" o ")}.`);
  }
  if (lleno(datos.correo_electronico) && !esCorreoValido(datos.correo_electronico)) {
    throw errorValidacion("correo_electronico no es un correo electrónico válido.");
  }
  const vence = datos.certificado_digital_vencimiento;
  if (vence !== null && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) {
    throw errorValidacion("certificado_digital_vencimiento debe tener el formato AAAA-MM-DD.");
  }
  if (datos.modo_facturacion === "electronica_dian") await validarModoElectronico(datos);

  return emisorModel.editar(datos);
}

// Datos iniciales del emisor (desde .env, o marcadores para completar luego con
// PUT /api/emisor) y la secuencia interna de numeración. Solo crea lo que falta.
async function asegurarDatosIniciales() {
  if (!(await emisorModel.obtener())) {
    const env = process.env;
    const nit = normalizarNit(env.EMISOR_NIT) || "000000000";
    await emisorModel.crear({
      razon_social: env.EMISOR_RAZON_SOCIAL || "(Configurar razón social)",
      nit,
      dv: calcularDv(nit),
      direccion: env.EMISOR_DIRECCION || "(Configurar dirección)",
      municipio: "Floridablanca",
      departamento: "Santander",
      telefono: env.EMISOR_TELEFONO || null,
      regimen: env.EMISOR_REGIMEN || "Régimen Simple de Tributación - SIMPLE",
      titulo_documento: "Comprobante de venta",
      leyenda_pie:
        "Documento interno de venta. No es factura electrónica de venta ni documento equivalente " +
        "validado por la DIAN. Precios con impuestos incluidos.",
      // Base para factura electrónica: apagada hasta que el dueño la configure.
      modo_facturacion: "interno",
      ambiente_dian: "pruebas",
      correo_electronico: PENDIENTE,
      tipo_persona: null,
      responsable_iva: 1,
      responsable_inc: 1,
      proveedor_tecnologico: PENDIENTE,
      certificado_digital_nombre: PENDIENTE,
      certificado_digital_vencimiento: null,
    });
  }
  await facturaModel.asegurarSecuenciaInicial();
}

module.exports = {
  validarDatosFactura,
  listarFacturas,
  obtenerFactura,
  anularFactura,
  obtenerXml,
  transmitirFactura,
  obtenerEmisor,
  editarEmisor,
  asegurarDatosIniciales,
};
