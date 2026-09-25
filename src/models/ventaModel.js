const db = require("../db/db");
const movimientoInventarioModel = require("./movimientoInventarioModel");
const facturaModel = require("./facturaModel");

// Cada cobro usa db.conTransaccion: un solo client del pool con
// BEGIN/COMMIT/ROLLBACK. Si algo falla a mitad de camino (crear venta, copiar
// líneas, descontar stock, marcar pedidos, liberar mesa, emitir factura), todo
// se revierte junto. El consecutivo de la factura se toma con FOR UPDATE
// (facturaModel), así dos cobros simultáneos no leen el mismo número.
// El stock se verifica antes de crear la venta (verificarStockParaVenta) para
// que una venta sin stock no consuma un id_venta de la secuencia.

async function crearVenta(cx, { tipo, id_mesa, id_usuario }) {
  const { id_venta } = await cx.uno(
    "INSERT INTO ventas (tipo, id_mesa, id_usuario, total) VALUES ($1, $2, $3, 0) RETURNING id_venta",
    [tipo, id_mesa, id_usuario]
  );
  return id_venta;
}

function copiarLinea(cx, { id_venta, id_pedido_detalle, id_producto, cantidad, precio_unitario }) {
  return cx.ejecutar(
    `INSERT INTO venta_detalle (id_venta, id_pedido_detalle, id_producto, cantidad, precio_unitario)
     VALUES ($1, $2, $3, $4, $5)`,
    [id_venta, id_pedido_detalle, id_producto, cantidad, precio_unitario]
  );
}

// US-14 / RF-14: consolida todos los pedidos abiertos (id_venta IS NULL) de
// la mesa en una única venta, copiando sus líneas a venta_detalle, y emite
// su factura. datosFactura = { forma_pago, tipo_consumo, cliente } ya validado.
function cerrarCuentaMesa(id_mesa, id_usuario, datosFactura) {
  return db.conTransaccion(async (cx) => {
    const pedidos = await cx.todos(
      "SELECT * FROM pedidos WHERE id_mesa = $1 AND id_venta IS NULL ORDER BY id_pedido FOR UPDATE",
      [id_mesa]
    );
    if (pedidos.length === 0) {
      const err = new Error("La mesa no tiene pedidos pendientes de cobro.");
      err.status = 400;
      throw err;
    }

    for (const pedido of pedidos) {
      pedido.lineas = await cx.todos("SELECT * FROM pedido_detalle WHERE id_pedido = $1 ORDER BY id_pedido_detalle", [
        pedido.id_pedido,
      ]);
    }
    await movimientoInventarioModel.verificarStockParaVenta(
      pedidos.flatMap((p) => p.lineas),
      cx
    );

    const id_venta = await crearVenta(cx, { tipo: "mesa", id_mesa, id_usuario });

    let total = 0;
    for (const pedido of pedidos) {
      for (const linea of pedido.lineas) {
        await copiarLinea(cx, {
          id_venta,
          id_pedido_detalle: linea.id_pedido_detalle,
          id_producto: linea.id_producto,
          cantidad: linea.cantidad,
          precio_unitario: linea.precio_unitario,
        });
        total += linea.cantidad * linea.precio_unitario;

        // RF-16: el descuento de stock ocurre en la misma transacción que la
        // venta; si no hay stock suficiente, todo el cierre de cuenta se revierte.
        await movimientoInventarioModel.descontarPorVenta(
          { id_producto: linea.id_producto, cantidad: linea.cantidad, id_venta, id_usuario },
          cx
        );
      }
      await cx.ejecutar("UPDATE pedidos SET id_venta = $1, estado = 'entregado' WHERE id_pedido = $2", [
        id_venta,
        pedido.id_pedido,
      ]);
    }

    await cx.ejecutar("UPDATE ventas SET total = $1 WHERE id_venta = $2", [total, id_venta]);
    await cx.ejecutar("UPDATE mesas SET estado = 'libre' WHERE id_mesa = $1", [id_mesa]);

    const factura = await facturaModel.emitir({ id_venta, id_mesa, id_usuario, ...datosFactura }, cx);
    return { ...(await buscarPorId(id_venta, cx)), factura };
  });
}

// US-15 / RF-15: venta sin mesa asociada; queda igual que una venta por mesa
// salvo por id_mesa = null (mismo esquema, mismo venta_detalle, sin pedido).
function crearVentaMostrador({ items, id_usuario, datosFactura }) {
  return db.conTransaccion(async (cx) => {
    await movimientoInventarioModel.verificarStockParaVenta(items, cx);
    const id_venta = await crearVenta(cx, { tipo: "mostrador", id_mesa: null, id_usuario });

    let total = 0;
    for (const item of items) {
      await copiarLinea(cx, {
        id_venta,
        id_pedido_detalle: null,
        id_producto: item.id_producto,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
      });
      total += item.cantidad * item.precio_unitario;

      // RF-16: mismo descuento atómico que en el cierre de cuenta por mesa.
      await movimientoInventarioModel.descontarPorVenta(
        { id_producto: item.id_producto, cantidad: item.cantidad, id_venta, id_usuario },
        cx
      );
    }

    await cx.ejecutar("UPDATE ventas SET total = $1 WHERE id_venta = $2", [total, id_venta]);

    const factura = await facturaModel.emitir({ id_venta, id_mesa: null, id_usuario, ...datosFactura }, cx);
    return { ...(await buscarPorId(id_venta, cx)), factura };
  });
}

async function buscarPorId(id_venta, cx = db) {
  const venta = await cx.uno(
    `SELECT v.*, u.nombre AS usuario_nombre, m.numero AS mesa_numero
     FROM ventas v
     JOIN usuarios u ON u.id_usuario = v.id_usuario
     LEFT JOIN mesas m ON m.id_mesa = v.id_mesa
     WHERE v.id_venta = $1`,
    [id_venta]
  );
  if (!venta) return null;

  const detalle = await cx.todos(
    `SELECT vd.*, p.nombre AS producto_nombre
     FROM venta_detalle vd
     JOIN productos p ON p.id_producto = vd.id_producto
     WHERE vd.id_venta = $1
     ORDER BY vd.id_venta_detalle`,
    [id_venta]
  );

  return { ...venta, detalle };
}

// RF-17: filtra por rango de fechas y por tipo (mesa/mostrador).
function listar({ desde, hasta, tipo, incluir_anuladas } = {}) {
  const f = db.filtros();
  // Las anuladas no suman en los reportes salvo que se pidan explícitamente.
  if (!incluir_anuladas) f.agregarFijo("v.estado = 'activa'");
  if (desde) f.agregarFecha("v.fecha_hora", ">=", desde);
  if (hasta) f.agregarFecha("v.fecha_hora", "<=", hasta);
  if (tipo) f.agregar("v.tipo = ?", tipo);
  // id_venta desempata ventas del mismo segundo en el orden en que SQLite las devolvía.
  return db.todos(
    `SELECT v.*, u.nombre AS usuario_nombre, m.numero AS mesa_numero,
            f.id_factura, f.numero_completo AS numero_factura
     FROM ventas v
     JOIN usuarios u ON u.id_usuario = v.id_usuario
     LEFT JOIN mesas m ON m.id_mesa = v.id_mesa
     LEFT JOIN facturas f ON f.id_venta = v.id_venta
     WHERE 1 = 1${f.where()}
     ORDER BY v.fecha_hora DESC, v.id_venta ASC`,
    f.params
  );
}

module.exports = { cerrarCuentaMesa, crearVentaMostrador, listar, buscarPorId };
