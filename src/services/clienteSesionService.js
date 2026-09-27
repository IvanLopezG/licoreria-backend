const mesaSesionModel = require("../models/mesaSesionModel");
const mesaModel = require("../models/mesaModel");
const pedidoModel = require("../models/pedidoModel");
const facturaModel = require("../models/facturaModel");

// Vista pública del cliente en el catálogo QR, autenticada con el token de
// sesión que recibió su celular al pedir (encabezado X-Sesion-Token, nunca en
// la URL). Solo ve su sesión: nunca otra mesa ni otra ocupación de la misma
// mesa, ni ids internos, ni el documento del cliente sin enmascarar.
//
// La factura es visible hasta SESION_FACTURA_MINUTOS (30 por defecto) después
// del cierre, o hasta que el cliente toca "Listo" (revoca su token). Sin cron:
// se valida al consultar. Después responde 410; la factura sigue en el sistema.

const MINUTOS_POR_DEFECTO = 30;

function minutosVigencia() {
  const n = Number(process.env.SESION_FACTURA_MINUTOS);
  return Number.isFinite(n) && n > 0 ? n : MINUTOS_POR_DEFECTO;
}

function errorConEstado(mensaje, status) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

// "YYYY-MM-DD HH:MM:SS" (UTC) → milisegundos.
const msUtc = (texto) => Date.parse(`${texto.replace(" ", "T")}Z`);
const textoUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

function venceEn(sesion) {
  return sesion.estado === "cerrada" && sesion.cerrada_en ? msUtc(sesion.cerrada_en) + minutosVigencia() * 60000 : null;
}

// Token → sesión vigente. 401 genérico si el token no existe (no revela nada);
// 410 si fue revocado ("Listo"), si la sesión se canceló o si ya venció.
async function autenticar(token) {
  const sesion = await mesaSesionModel.buscarPorToken(token);
  if (!sesion) throw errorConEstado("Sesión no válida.", 401);
  if (sesion.revocado_en || sesion.estado === "cancelada") throw errorConEstado("Esta cuenta ya no está disponible.", 410);
  const vence = venceEn(sesion);
  if (vence !== null && Date.now() > vence) throw errorConEstado("Esta cuenta ya no está disponible.", 410);
  return sesion;
}

// Cambia cuando cambia cualquier cosa visible: revision sube con cada pedido,
// entrega, cierre, anulación o reapertura.
const etagDe = (sesion) => `W/"${sesion.revision}-${sesion.estado}"`;

// Solo los últimos 3 dígitos del documento.
function enmascarar(num_doc) {
  if (!num_doc) return null;
  const visible = num_doc.slice(-3);
  return `${"*".repeat(Math.max(num_doc.length - 3, 3))}${visible}`;
}

function resumenFactura(f) {
  return {
    titulo_documento: f.titulo_documento,
    numero: f.numero_completo,
    fecha_expedicion: f.fecha_expedicion,
    emisor: {
      razon_social: f.emisor_razon_social,
      nit: `${f.emisor_nit}-${f.emisor_dv}`,
      direccion: f.emisor_direccion,
      municipio: f.emisor_municipio,
      departamento: f.emisor_departamento,
      telefono: f.emisor_telefono,
      regimen: f.emisor_regimen,
    },
    cliente: {
      nombre: f.cliente_nombre,
      documento: f.cliente_num_doc ? `${f.cliente_tipo_doc} ${enmascarar(f.cliente_num_doc)}` : null,
    },
    items: f.items.map((i) => ({
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      tasa_iva_bps: i.tasa_iva_bps,
      tasa_inc_bps: i.tasa_inc_bps,
      total_linea: i.total_linea,
    })),
    subtotal: f.subtotal,
    total_iva: f.total_iva,
    total_inc: f.total_inc,
    total: f.total,
    forma_pago: f.forma_pago,
    leyenda_pie: f.leyenda_pie,
  };
}

async function estado(sesion) {
  const mesa = await mesaModel.buscarPorId(sesion.id_mesa);
  const pedidos = (await pedidoModel.listarPorSesion(sesion.id_sesion)).map((p, i) => ({
    numero: i + 1,
    fecha_hora: p.fecha_hora,
    estado: p.estado,
    items: p.items.map((it) => ({ producto: it.producto_nombre, cantidad: it.cantidad, precio_unitario: it.precio_unitario })),
  }));
  const total_pedidos = pedidos.reduce(
    (suma, p) => suma + p.items.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0),
    0
  );

  let factura = null;
  let factura_anulada = false;
  if (sesion.estado === "cerrada" && sesion.id_factura) {
    const f = await facturaModel.buscarPorId(sesion.id_factura);
    if (f && f.estado === "emitida") factura = resumenFactura(f);
    else factura_anulada = true;
  }

  const vence = venceEn(sesion);
  return {
    estado: sesion.estado,
    revision: sesion.revision,
    mesa: { numero: mesa.numero },
    reabierta: sesion.estado === "activa" && sesion.reabierta === 1,
    pedidos,
    total_pedidos,
    factura,
    factura_anulada,
    vence_en: vence === null ? null : textoUtc(vence),
  };
}

// Factura completa para el PDF: solo con la sesión cerrada y la factura emitida.
async function facturaParaPdf(sesion) {
  if (sesion.estado !== "cerrada" || !sesion.id_factura) throw errorConEstado("La cuenta aún no se ha cerrado.", 404);
  const f = await facturaModel.buscarPorId(sesion.id_factura);
  if (!f || f.estado !== "emitida") throw errorConEstado("Esta factura ya no está disponible.", 410);
  return f;
}

async function listo(token) {
  const sesion = await mesaSesionModel.buscarPorToken(token);
  if (!sesion) throw errorConEstado("Sesión no válida.", 401);
  if (sesion.revocado_en) throw errorConEstado("Esta cuenta ya no está disponible.", 410);
  await mesaSesionModel.revocarToken(sesion.id_token);
  return { ok: true };
}

module.exports = { autenticar, etagDe, estado, facturaParaPdf, listo, minutosVigencia };
