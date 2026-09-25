const db = require("../db/db");
const emisorModel = require("./emisorModel");
const movimientoInventarioModel = require("./movimientoInventarioModel");
const { calcularLinea, totalizar } = require("../utils/impuestos");

// Las líneas de la venta, consolidadas por producto y precio: al cerrar una
// mesa, el mismo producto pudo pedirse en varios pedidos y en la factura
// debe verse una sola vez. Nombre y tasas se leen del producto al emitir.
// SUM de integer da bigint en Postgres: se castea a integer.
const SQL_LINEAS_VENTA = `
  SELECT vd.id_producto, vd.precio_unitario, SUM(vd.cantidad)::integer AS cantidad,
         p.nombre, p.tasa_iva_bps, p.tasa_inc_bps
  FROM venta_detalle vd
  JOIN productos p ON p.id_producto = vd.id_producto
  WHERE vd.id_venta = $1
  GROUP BY vd.id_producto, vd.precio_unitario, p.nombre, p.tasa_iva_bps, p.tasa_inc_bps
  ORDER BY MIN(vd.id_venta_detalle)
`;

const COLUMNAS_FACTURA = [
  "id_secuencia", "numero", "numero_completo", "id_venta", "id_mesa", "id_usuario", "tipo_consumo",
  "emisor_razon_social", "emisor_nit", "emisor_dv", "emisor_direccion", "emisor_municipio",
  "emisor_departamento", "emisor_telefono", "emisor_regimen", "titulo_documento", "leyenda_pie",
  "cliente_nombre", "cliente_tipo_doc", "cliente_num_doc", "cliente_dv", "forma_pago",
  "subtotal", "total_iva", "total_inc", "total_impuestos", "total",
];

const COLUMNAS_ITEM = [
  "id_factura", "id_producto", "descripcion", "cantidad", "precio_unitario", "base_linea",
  "tasa_iva_bps", "valor_iva", "tasa_inc_bps", "valor_inc", "total_linea",
];

function insertar(tabla, columnas, retorno = "") {
  const marcadores = columnas.map((_, i) => `$${i + 1}`).join(", ");
  return `INSERT INTO ${tabla} (${columnas.join(", ")}) VALUES (${marcadores})${retorno}`;
}

function errorFacturacion(mensaje) {
  const err = new Error(mensaje);
  err.status = 500;
  return err;
}

// Toma el siguiente número de la secuencia activa. Debe llamarse dentro de la
// transacción que crea la venta: si algo falla después, el ROLLBACK devuelve
// el número y no queda un salto en la numeración. FOR UPDATE bloquea la fila
// de la secuencia hasta el COMMIT, así dos cobros simultáneos se turnan.
async function tomarSiguienteNumero(cx) {
  const secuencia = await cx.uno("SELECT * FROM secuencias_factura WHERE activa = 1 FOR UPDATE");
  if (!secuencia) throw errorFacturacion("No hay una secuencia de facturación activa.");

  const siguiente = Math.max(secuencia.numero_actual + 1, secuencia.rango_desde);
  if (secuencia.rango_hasta !== null && siguiente > secuencia.rango_hasta) {
    throw errorFacturacion("Se agotó el rango de numeración de facturas.");
  }
  if (secuencia.vigencia_hasta && new Date().toISOString().slice(0, 10) > secuencia.vigencia_hasta) {
    throw errorFacturacion("La resolución de numeración de facturas está vencida.");
  }

  const cambio = await cx.ejecutar(
    "UPDATE secuencias_factura SET numero_actual = $1 WHERE id_secuencia = $2 AND numero_actual = $3",
    [siguiente, secuencia.id_secuencia, secuencia.numero_actual]
  );
  if (cambio.rowCount !== 1) throw errorFacturacion("No se pudo reservar el número de factura.");

  return {
    id_secuencia: secuencia.id_secuencia,
    numero: siguiente,
    numero_completo: `${secuencia.prefijo || ""}${siguiente}`,
  };
}

// Emite la factura de una venta ya creada. NO abre transacción propia:
// ventaModel le pasa el client (cx) de la transacción que crea la venta, igual
// que a descontarPorVenta, para que venta, stock y factura sean atómicos.
async function emitir({ id_venta, id_mesa, id_usuario, tipo_consumo, forma_pago, cliente }, cx) {
  const emisor = await emisorModel.obtener(cx);
  if (!emisor) throw errorFacturacion("Faltan los datos del emisor de la factura.");

  const lineas = (await cx.todos(SQL_LINEAS_VENTA, [id_venta])).map((l) => ({
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

  const numeracion = await tomarSiguienteNumero(cx);

  const datos = {
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
  };
  const { id_factura } = await cx.uno(
    insertar("facturas", COLUMNAS_FACTURA, " RETURNING id_factura"),
    COLUMNAS_FACTURA.map((c) => datos[c])
  );

  for (const linea of lineas) {
    const item = { id_factura, ...linea };
    await cx.ejecutar(insertar("factura_items", COLUMNAS_ITEM), COLUMNAS_ITEM.map((c) => item[c]));
  }

  return buscarPorId(id_factura, cx);
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

async function buscarPorId(id_factura, cx = db) {
  const factura = await cx.uno(`${SELECT_FACTURA} WHERE f.id_factura = $1`, [id_factura]);
  if (!factura) return null;
  const items = await cx.todos("SELECT * FROM factura_items WHERE id_factura = $1 ORDER BY id_item", [id_factura]);
  return { ...factura, items };
}

async function buscarPorVenta(id_venta) {
  const fila = await db.uno("SELECT id_factura FROM facturas WHERE id_venta = $1", [id_venta]);
  return fila ? buscarPorId(fila.id_factura) : null;
}

function listar({ desde, hasta } = {}) {
  const f = db.filtros();
  if (desde) f.agregarFecha("f.fecha_expedicion", ">=", desde);
  if (hasta) f.agregarFecha("f.fecha_expedicion", "<=", hasta);
  return db.todos(`${SELECT_FACTURA} WHERE 1 = 1${f.where()} ORDER BY f.id_factura DESC`, f.params);
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
// La anulación toca factura, venta, stock, pedidos y mesa: una sola transacción.
function anular({ id_factura, id_usuario, motivo, reabrir_pedidos }) {
  return db.conTransaccion(async (cx) => {
    // FOR UPDATE: dos anulaciones simultáneas de la misma factura se turnan y
    // la segunda ve el estado "anulada".
    const factura = await cx.uno("SELECT * FROM facturas WHERE id_factura = $1 FOR UPDATE", [id_factura]);
    if (!factura) throw errorConEstado("Factura no encontrada.", 404);
    if (factura.estado === "anulada") throw errorConEstado("La factura ya está anulada.", 409);

    const venta = await cx.uno("SELECT * FROM ventas WHERE id_venta = $1", [factura.id_venta]);

    if (reabrir_pedidos) {
      if (venta.tipo !== "mesa") {
        throw errorConEstado("Solo se pueden reabrir pedidos de una venta de mesa.", 400);
      }
      const { n: abiertos } = await cx.uno(
        "SELECT COUNT(*) AS n FROM pedidos WHERE id_mesa = $1 AND id_venta IS NULL",
        [venta.id_mesa]
      );
      if (abiertos > 0) {
        throw errorConEstado(
          "La mesa ya tiene pedidos abiertos de otro cliente. Cierre esa cuenta antes de reabrir estos pedidos.",
          409
        );
      }
    }

    await cx.ejecutar(
      `UPDATE facturas
       SET estado = 'anulada', motivo_anulacion = $1,
           fecha_anulacion = date_trunc('second', now() AT TIME ZONE 'utc'), id_usuario_anulacion = $2
       WHERE id_factura = $3`,
      [motivo, id_usuario, id_factura]
    );
    await cx.ejecutar("UPDATE ventas SET estado = 'anulada' WHERE id_venta = $1", [venta.id_venta]);

    const lineas = await cx.todos(
      "SELECT id_producto, cantidad FROM venta_detalle WHERE id_venta = $1 ORDER BY id_venta_detalle",
      [venta.id_venta]
    );
    for (const linea of lineas) {
      await movimientoInventarioModel.devolverPorAnulacion({ ...linea, id_venta: venta.id_venta, id_usuario }, cx);
    }

    if (reabrir_pedidos) {
      await cx.ejecutar("UPDATE pedidos SET id_venta = NULL WHERE id_venta = $1", [venta.id_venta]);
      await cx.ejecutar("UPDATE mesas SET estado = 'ocupada' WHERE id_mesa = $1", [venta.id_mesa]);
    }

    return buscarPorId(id_factura, cx);
  });
}

async function asegurarSecuenciaInicial() {
  const activa = await db.uno("SELECT 1 FROM secuencias_factura WHERE activa = 1");
  if (!activa) {
    await db.ejecutar("INSERT INTO secuencias_factura (prefijo, numero_actual, rango_desde) VALUES (NULL, 0, 1)");
  }
}

module.exports = { emitir, anular, buscarPorId, buscarPorVenta, listar, asegurarSecuenciaInicial };
