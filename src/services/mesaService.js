const QRCode = require("qrcode");
const mesaModel = require("../models/mesaModel");

async function crearMesa({ numero }) {
  if (numero === undefined || numero === null || Number(numero) <= 0) {
    const err = new Error("numero es obligatorio y debe ser mayor a 0.");
    err.status = 400;
    throw err;
  }
  if (await mesaModel.buscarPorNumero(Number(numero))) {
    const err = new Error("Ya existe una mesa con ese número.");
    err.status = 400;
    throw err;
  }
  return mesaModel.crear({ numero: Number(numero) });
}

function listarMesas() {
  return mesaModel.listar();
}

async function obtenerMesa(id_mesa) {
  const mesa = await mesaModel.buscarPorId(id_mesa);
  if (!mesa) {
    const err = new Error("Mesa no encontrada.");
    err.status = 404;
    throw err;
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
