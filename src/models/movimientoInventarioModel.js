const db = require("../db/db");
const productoModel = require("./productoModel");

const SELECT_MOVIMIENTO = `
  SELECT m.*, u.nombre AS usuario_nombre, p.nombre AS producto_nombre
  FROM movimientos_inventario m
  JOIN usuarios u ON u.id_usuario = m.id_usuario
  JOIN productos p ON p.id_producto = m.id_producto
`;

async function _registrar({ id_producto, tipo, motivo, cantidad, id_proveedor, id_venta, id_usuario }, cx) {
  const { id_movimiento } = await cx.uno(
    `INSERT INTO movimientos_inventario (id_producto, tipo, motivo, cantidad, id_proveedor, id_venta, id_usuario)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id_movimiento`,
    [id_producto, tipo, motivo, cantidad, id_proveedor || null, id_venta || null, id_usuario]
  );
  return buscarPorId(id_movimiento, cx);
}

function buscarPorId(id_movimiento, cx = db) {
  return cx.uno(`${SELECT_MOVIMIENTO} WHERE m.id_movimiento = $1`, [id_movimiento]);
}

// Ajustar stock_actual y registrar el movimiento van en la misma transacción.
function registrarEntrada({ id_producto, cantidad, id_proveedor, id_usuario }) {
  return db.conTransaccion(async (cx) => {
    await productoModel.ajustarStock(id_producto, cantidad, cx);
    return _registrar({ id_producto, tipo: "entrada", motivo: "compra", cantidad, id_proveedor, id_usuario }, cx);
  });
}

function registrarSalida({ id_producto, cantidad, motivo, id_usuario }) {
  return db.conTransaccion(async (cx) => {
    await productoModel.ajustarStock(id_producto, -cantidad, cx);
    return _registrar({ id_producto, tipo: "salida", motivo, cantidad, id_proveedor: null, id_usuario }, cx);
  });
}

function listar({ id_producto, desde, hasta, id_usuario } = {}) {
  const f = db.filtros();
  if (id_producto) f.agregar("m.id_producto = ?", id_producto);
  if (desde) f.agregarFecha("m.fecha_hora", ">=", desde);
  if (hasta) f.agregarFecha("m.fecha_hora", "<=", hasta);
  // RF-18: filtrar el historial por usuario responsable.
  if (id_usuario) f.agregar("m.id_usuario = ?", id_usuario);
  // id_movimiento desempata movimientos del mismo segundo en el orden en que SQLite los devolvía.
  return db.todos(`${SELECT_MOVIMIENTO} WHERE 1 = 1${f.where()} ORDER BY m.fecha_hora DESC, m.id_movimiento ASC`, f.params);
}

// Verifica, antes de crear la venta, que las líneas se pueden descontar en
// orden, con el mismo resultado y mensaje que descontarPorVenta línea por línea
// (incluido un producto repetido en varias líneas). Bloquea cada producto con
// FOR UPDATE hasta el COMMIT. Así una venta sin stock falla antes del INSERT
// en ventas: en Postgres un ROLLBACK no devuelve el id ya tomado de la
// secuencia y quedaría un hueco en id_venta (con SQLite no quedaba).
async function verificarStockParaVenta(lineas, cx) {
  const disponible = new Map();
  for (const { id_producto, cantidad } of lineas) {
    if (!disponible.has(id_producto)) {
      const producto = await productoModel.buscarPorIdParaActualizar(id_producto, cx);
      if (!producto) {
        const err = new Error(`Producto ${id_producto} no encontrado.`);
        err.status = 404;
        throw err;
      }
      disponible.set(id_producto, { nombre: producto.nombre, stock: producto.stock_actual });
    }
    const producto = disponible.get(id_producto);
    if (producto.stock < cantidad) {
      const err = new Error(`No hay stock suficiente de "${producto.nombre}" para completar la venta.`);
      err.status = 400;
      throw err;
    }
    producto.stock -= cantidad;
  }
}

// RF-16: descuenta stock por una venta (mesa o mostrador) reutilizando la
// misma validación de stock suficiente que registrarSalida (US-07), pero SIN
// abrir su propia transacción: quien llama (ventaModel) pasa su client (cx)
// para que la venta y el descuento de inventario sean atómicos. La fila del
// producto queda bloqueada (FOR UPDATE) hasta el COMMIT de la venta.
async function descontarPorVenta({ id_producto, cantidad, id_venta, id_usuario }, cx) {
  const producto = await productoModel.buscarPorIdParaActualizar(id_producto, cx);
  if (!producto) {
    const err = new Error(`Producto ${id_producto} no encontrado.`);
    err.status = 404;
    throw err;
  }
  if (producto.stock_actual < cantidad) {
    const err = new Error(`No hay stock suficiente de "${producto.nombre}" para completar la venta.`);
    err.status = 400;
    throw err;
  }

  await productoModel.ajustarStock(id_producto, -cantidad, cx);
  return _registrar({ id_producto, tipo: "salida", motivo: "venta", cantidad, id_proveedor: null, id_venta, id_usuario }, cx);
}

// Anulación de factura: devuelve al stock lo que la venta descontó, como una
// entrada con motivo "anulacion" ligada a la venta (queda en el Kardex).
// Igual que descontarPorVenta, participa de la transacción de quien llama.
async function devolverPorAnulacion({ id_producto, cantidad, id_venta, id_usuario }, cx) {
  await productoModel.ajustarStock(id_producto, cantidad, cx);
  return _registrar({ id_producto, tipo: "entrada", motivo: "anulacion", cantidad, id_proveedor: null, id_venta, id_usuario }, cx);
}

module.exports = {
  registrarEntrada,
  registrarSalida,
  listar,
  verificarStockParaVenta,
  descontarPorVenta,
  devolverPorAnulacion,
};
