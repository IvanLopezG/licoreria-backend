const crypto = require("crypto");

// CUFE (Código Único de Factura Electrónica), Anexo Técnico de la Resolución
// DIAN 000165 de 2023:
//
//   CUFE = SHA-384( NumFac + FecFac + HorFac + ValFac
//                 + "01" + ValImp1 + "04" + ValImp2 + "03" + ValImp3
//                 + ValTot + NitFE + NumAdq + ClTec + TipoAmbiente )
//
// Todo concatenado sin separadores; el resultado en hexadecimal en minúscula
// (96 caracteres). Valores con 2 decimales, punto decimal y sin separador de
// miles. 01 = IVA, 04 = INC, 03 = ICA (no se maneja: siempre 0.00).
//
// Con un proveedor tecnológico, el CUFE válido es el que devuelve el
// proveedor; este cálculo es la base para "software propio" y para la
// previsualización local.

// Número de identificación del adquiriente cuando es Consumidor Final.
const ADQUIRIENTE_CONSUMIDOR_FINAL = "222222222222";

// TipoAmbiente del anexo: 1 = producción, 2 = pruebas.
const CODIGO_AMBIENTE = { produccion: "1", pruebas: "2" };

const URL_VERIFICACION = {
  produccion: "https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=",
  pruebas: "https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=",
};

const valor = (n) => Number(n).toFixed(2);
const soloDigitos = (texto) => String(texto ?? "").replace(/\D/g, "");

// Colombia es UTC-5 todo el año (sin horario de verano).
const DESFASE_COLOMBIA_MS = 5 * 60 * 60 * 1000;

// fecha_expedicion se guarda en UTC ("2026-09-24 03:53:39"); la DIAN pide
// fecha y hora locales con el desfase: "2026-09-23" y "22:53:39-05:00".
function fechaHoraColombia(utc) {
  const local = new Date(new Date(utc.replace(" ", "T") + "Z").getTime() - DESFASE_COLOMBIA_MS);
  const iso = local.toISOString();
  return { fecha: iso.slice(0, 10), hora: `${iso.slice(11, 19)}-05:00` };
}

function cadenaCufe(d) {
  return [
    d.numero_completo,
    d.fecha,
    d.hora,
    valor(d.subtotal),
    "01", valor(d.total_iva),
    "04", valor(d.total_inc),
    "03", valor(0),
    valor(d.total),
    soloDigitos(d.nit_emisor),
    d.num_adquiriente ? soloDigitos(d.num_adquiriente) : ADQUIRIENTE_CONSUMIDOR_FINAL,
    d.clave_tecnica,
    CODIGO_AMBIENTE[d.ambiente],
  ].join("");
}

function calcularCufe(datos) {
  if (!CODIGO_AMBIENTE[datos.ambiente]) throw new Error(`Ambiente DIAN inválido: ${datos.ambiente}`);
  if (!datos.clave_tecnica) throw new Error("Falta la clave técnica para calcular el CUFE.");
  return crypto.createHash("sha384").update(cadenaCufe(datos), "utf8").digest("hex");
}

function urlVerificacion(cufe, ambiente) {
  return URL_VERIFICACION[ambiente] + cufe;
}

module.exports = {
  ADQUIRIENTE_CONSUMIDOR_FINAL,
  CODIGO_AMBIENTE,
  fechaHoraColombia,
  cadenaCufe,
  calcularCufe,
  urlVerificacion,
};
