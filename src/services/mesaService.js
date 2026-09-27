const QRCode = require("qrcode");
const mesaModel = require("../models/mesaModel");
const { ErrorNoEncontrado, ErrorValidacion } = require("../utils/errores");

async function crearMesa({ numero }) {
  if (numero === undefined || numero === null || Number(numero) <= 0) {
    throw new ErrorValidacion("numero es obligatorio y debe ser mayor a 0.");
  }
  if (await mesaModel.buscarPorNumero(Number(numero))) {
    throw new ErrorValidacion("Ya existe una mesa con ese número.");
  }
  return mesaModel.crear({ numero: Number(numero) });
}

function listarMesas() {
  return mesaModel.listar();
}

async function obtenerMesa(id_mesa) {
  const mesa = await mesaModel.buscarPorId(id_mesa);
  if (!mesa) {
    throw new ErrorNoEncontrado("Mesa no encontrada.");
  }
  return mesa;
}

// RF-10: el QR apunta al catálogo público usando codigo_qr_token, nunca id_mesa.
// BASE_URL viene del .env (en Render, la URL pública real) para no depender
// de req.protocol/req.host, que detrás de un proxy pueden no reflejar la URL real.
async function generarQR(id_mesa) {
  const mesa = await obtenerMesa(id_mesa);
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const url = `${baseUrl}/catalogo/index.html?token=${mesa.codigo_qr_token}`;
  const qr_data_url = await QRCode.toDataURL(url);
  return { mesa_numero: mesa.numero, url, qr_data_url };
}

module.exports = { crearMesa, listarMesas, obtenerMesa, generarQR };
