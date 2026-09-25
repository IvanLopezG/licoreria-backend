const db = require("../db/db");
const emisorModel = require("./emisorModel");
const movimientoInventarioModel = require("./movimientoInventarioModel");
const { calcularLinea, totalizar } = require("../utils/impuestos");

// Las líneas de la venta, consolidadas por producto y precio: al cerrar una
// mesa, el mismo producto pudo pedirse en varios pedidos y en la factura
// debe verse una sola vez. Nombre y tasas se leen del producto al emitir.
const stmtLineasVenta = db.prepare(`
  SELECT vd.id_producto, vd.precio_unitario, SUM(vd.cantidad) AS cantidad,
         p.nombre, p.tasa_iva_bps, p.tasa_inc_bps
  FROM venta_detalle vd
  JOIN productos p ON p.id_producto = vd.id_producto
  WHERE vd.id_venta = ?
  GROUP BY vd.id_producto, vd.precio_unitario, p.nombre, p.tasa_iva_bps, p.tasa_inc_bps
  ORDER BY MIN(vd.id_venta_detalle)
`);

const stmtSecuenciaActiva = db.prepare("SELECT * FROM secuencias_factura WHERE activa = 1");

const stmtAvanzarSecuencia = db.prepare(`
  UPDATE secuencias_factura SET numero_actual = @siguiente
  WHERE id_secuencia = @id_secuencia AND numero_actual = @actual
`);

const stmtCrearFactura = db.prepare(`
  INSERT INTO facturas (
    id_secuencia, numero, numero_completo, id_venta, id_mesa, id_usuario, tipo_consumo,
    emisor_razon_social, emisor_nit, emisor_dv, emisor_direccion, emisor_municipio,
    emisor_departamento, emisor_telefono, emisor_regimen, titulo_documento, leyenda_pie,
    cliente_nombre, cliente_tipo_doc, cliente_num_doc, cliente_dv, forma_pago,
    subtotal, total_iva, total_inc, total_impuestos, total
  ) VALUES (
    @id_secuencia, @numero, @numero_completo, @id_venta, @id_mesa, @id_usuario, @tipo_consumo,
    @emisor_razon_social, @emisor_nit, @emisor_dv, @emisor_direccion, @emisor_municipio,
    @emisor_departamento, @emisor_telefono, @emisor_regimen, @titulo_documento, @leyenda_pie,
    @cliente_nombre, @cliente_tipo_doc, @cliente_num_doc, @cliente_dv, @forma_pago,
    @subtotal, @total_iva, @total_inc, @total_impuestos, @total
  )
`);

const stmtCrearItem = db.prepare(`
  INSERT INTO factura_items (
    id_factura, id_producto, descripcion, cantidad, precio_unitario, base_linea,
    tasa_iva_bps, valor_iva, tasa_inc_bps, valor_inc, total_linea
  ) VALUES (
    @id_factura, @id_producto, @descripcion, @cantidad, @precio_unitario, @base_linea,
    @tasa_iva_bps, @valor_iva, @tasa_inc_bps, @valor_inc, @total_linea
  )
`);

function errorFacturacion(mensaje) {
  const err = new Error(mensaje);
  err.status = 500;
  return err;
}

// Toma el siguiente número de la secuencia activa. Debe llamarse dentro de la
// transacción que crea la venta: si algo falla después, el ROLLBACK devuelve
// el número y no queda un salto en la numeración.
function tomarSiguienteNumero() {
  const secuencia = stmtSecuenciaActiva.get();
  if (!secuencia) throw errorFacturacion("No hay una secuencia de facturación activa.");

  const siguiente = Math.max(secuencia.numero_actual + 1, secuencia.rango_desde);
  if (secuencia.rango_hasta !== null && siguiente > secuencia.rango_hasta) {
    throw errorFacturacion("Se agotó el rango de numeración de facturas.");
  }
  if (secuencia.vigencia_hasta && new Date().toISOString().slice(0, 10) > secuencia.vigencia_hasta) {
    throw errorFacturacion("La resolución de numeración de facturas está vencida.");
  }

  const cambio = stmtAvanzarSecuencia.run({
    id_secuencia: secuencia.id_secuencia,
    actual: secuencia.numero_actual,
    siguiente,
  });
  if (cambio.changes !== 1) throw errorFacturacion("No se pudo reservar el número de factura.");

  return {
    id_secuencia: secuencia.id_secuencia,
    numero: siguiente,
    numero_completo: `${secuencia.prefijo || ""}${siguiente}`,
  };
}

// Emite la factura de una venta ya creada. NO abre transacción propia:
// ventaModel la llama dentro del mismo BEGIN/COMMIT que crea la venta, igual
// que descontarPorVenta, para que venta, stock y factura sean atómicos.
function emitir({ id_venta, id_mesa, id_usuario, tipo_consumo, forma_pago, cliente }) {
  const emisor = emisorModel.obtener();
  if (!emisor) throw errorFacturacion("Faltan los datos del emisor de la factura.");

  const lineas = stmtLineasVenta.all(id_venta).map((l) => ({
    id_producto: l.id_producto,
    descripcion: l.nombre,
    ...calcularLinea({
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      tasa_iva_bps: l.tasa_iva_bps,
      tasa_inc_bps: l.tasa_inc_bps,
      tipo_consumo,
    }),
  }));

  const numeracion = tomarSiguienteNumero();

  const id_factura = stmtCrearFactura.run({
    ...numeracion,
    id_venta,
    id_mesa: id_mesa ?? null,
    id_usuario,
    tipo_consumo,
    emisor_razon_social: emisor.razon_social,
    emisor_nit: emisor.nit,
    emisor_dv: emisor.dv,
    emisor_direccion: emisor.direccion,
    emisor_municipio: emisor.municipio,
    emisor_departamento: emisor.departamento,
    emisor_telefono: emisor.telefono,
    emisor_regimen: emisor.regimen,
    titulo_documento: emisor.titulo_documento,
    leyenda_pie: emisor.leyenda_pie,
    cliente_nombre: cliente.nombre,
    cliente_tipo_doc: cliente.tipo_doc,
    cliente_num_doc: cliente.num_doc,
    cliente_dv: cliente.dv,
    forma_pago,
    ...totalizar(lineas),
  }).lastInsertRowid;

  for (const linea of lineas) {
    stmtCrearItem.run({ id_factura, ...linea });
  }

  return buscarPorId(id_factura);
}

const SELECT_FACTURA = `
  SELECT f.*, u.nombre AS usuario_nombre, m.numero AS mesa_numero, ua.nombre AS usuario_anulacion_nombre,
         s.prefijo, s.rango_desde, s.rango_hasta, s.resolucion_numero, s.resolucion_fecha
  FROM facturas f
  JOIN usuarios u ON u.id_usuario = f.id_usuario
  JOIN secuencias_factura s ON s.id_secuencia = f.id_secuencia
  LEFT JOIN usuarios ua ON ua.id_usuario = f.id_usuario_anulacion
  LEFT JOIN mesas m ON m.id_mesa = f.id_mesa
`;

function buscarPorId(id_factura) {
  const factura = db.prepare(`${SELECT_FACTURA} WHERE f.id_factura = ?`).get(id_factura);
  if (!factura) return null;
  const items = db.prepare("SELECT * FROM factura_items WHERE id_factura = ? ORDER BY id_item").all(id_factura);
  return { ...factura, items };
}

function buscarPorVenta(id_venta) {
  const fila = db.prepare("SELECT id_factura FROM facturas WHERE id_venta = ?").get(id_venta);
  return fila ? buscarPorId(fila.id_factura) : null;
}

function listar({ desde, hasta } = {}) {
  let query = `${SELECT_FACTURA} WHERE 1 = 1`;
  const params = {};
  if (desde) {
    query += " AND date(f.fecha_expedicion) >= date(@desde)";
    params.desde = desde;
  }
  if (hasta) {
    query += " AND date(f.fecha_expedicion) <= date(@hasta)";
    params.hasta = hasta;
  }
  query += " ORDER BY f.id_factura DESC";
  return db.prepare(query).all(params);
}

// Mismo helper que ventaModel (BEGIN IMMEDIATE): la anulación toca factura,
// venta, stock, pedidos y mesa, y debe aplicarse completa o no aplicarse.
function conTransaccion(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const resultado = fn();
    db.exec("COMMIT");
    return resultado;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function errorConEstado(mensaje, status) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

// Anula la factura y revierte su venta: devuelve el stock (entradas con motivo
// "anulacion") y marca la venta como anulada. El número de factura no se
// reutiliza ni se descuenta del consecutivo.
// Con reabrir_pedidos (solo ventas de mesa), los pedidos vuelven a quedar
// abiertos y la mesa ocupada, para cobrarlos otra vez con una factura nueva y
// el mismo tratamiento tributario (consumo en el sitio).
function anular({ id_factura, id_usuario, motivo, reabrir_pedidos }) {
  return conTransaccion(() => {
    const factura = db.prepare("SELECT * FROM facturas WHERE id_factura = ?").get(id_factura);
    if (!factura) throw errorConEstado("Factura no encontrada.", 404);
    if (factura.estado === "anulada") throw errorConEstado("La factura ya está anulada.", 409);

    const venta = db.prepare("SELECT * FROM ventas WHERE id_venta = ?").get(factura.id_venta);

    if (reabrir_pedidos) {
      if (venta.tipo !== "mesa") {
        throw errorConEstado("Solo se pueden reabrir pedidos de una venta de mesa.", 400);
      }
      const abiertos = db
        .prepare("SELECT COUNT(*) AS n FROM pedidos WHERE id_mesa = ? AND id_venta IS NULL")
        .get(venta.id_mesa).n;
      if (abiertos > 0) {
        throw errorConEstado(
          "La mesa ya tiene pedidos abiertos de otro cliente. Cierre esa cuenta antes de reabrir estos pedidos.",
          409
        );
      }
    }

    db.prepare(`
      UPDATE facturas
      SET estado = 'anulada', motivo_anulacion = ?, fecha_anulacion = datetime('now'), id_usuario_anulacion = ?
      WHERE id_factura = ?
    `).run(motivo, id_usuario, id_factura);
    db.prepare("UPDATE ventas SET estado = 'anulada' WHERE id_venta = ?").run(venta.id_venta);

    const lineas = db.prepare("SELECT id_producto, cantidad FROM venta_detalle WHERE id_venta = ?").all(venta.id_venta);
    for (const linea of lineas) {
      movimientoInventarioModel.devolverPorAnulacion({ ...linea, id_venta: venta.id_venta, id_usuario });
    }

    if (reabrir_pedidos) {
      db.prepare("UPDATE pedidos SET id_venta = NULL WHERE id_venta = ?").run(venta.id_venta);
      db.prepare("UPDATE mesas SET estado = 'ocupada' WHERE id_mesa = ?").run(venta.id_mesa);
    }

    return buscarPorId(id_factura);
  });
}

function asegurarSecuenciaInicial() {
  if (!stmtSecuenciaActiva.get()) {
    db.prepare("INSERT INTO secuencias_factura (prefijo, numero_actual, rango_desde) VALUES (NULL, 0, 1)").run();
  }
}

module.exports = { emitir, anular, buscarPorId, buscarPorVenta, listar, asegurarSecuenciaInicial };
