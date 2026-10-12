const db = require("../db/db");

// Reportes por periodo: todo se agrega en SQL.
//
// $1 = desde y $2 = hasta son fechas de calendario de Colombia ("AAAA-MM-DD",
// inclusivas). fecha_hora se guarda en UTC y Colombia es UTC-5 todo el año (igual
// que utils/fechaColombia.js), así que el día D de Colombia va de D 05:00 a D+1
// 05:00 en UTC. Se compara la columna tal cual (sin convertirla) para no
// depender de la zona horaria de la sesión de Postgres.
const DESDE_UTC = "($1::date + interval '5 hours')";
const HASTA_UTC = "($2::date + interval '1 day 5 hours')";
const EN_RANGO = (columna) => `${columna} >= ${DESDE_UTC} AND ${columna} < ${HASTA_UTC}`;

// Las ventas anuladas no suman, igual que en GET /api/ventas.
const VENDIDOS = `
  SELECT vd.id_producto, SUM(vd.cantidad) AS unidades, SUM(vd.cantidad * vd.precio_unitario) AS total
  FROM venta_detalle vd
  JOIN ventas v ON v.id_venta = vd.id_venta
  WHERE v.estado = 'activa' AND ${EN_RANGO("v.fecha_hora")}
  GROUP BY vd.id_producto`;

function resumenVentas(desde, hasta) {
  return db.uno(
    `SELECT ROUND(COALESCE(SUM(total), 0)::numeric, 2) AS total_vendido,
            COUNT(*) AS numero_ventas,
            ROUND(COALESCE(AVG(total), 0)::numeric, 2) AS ticket_promedio
     FROM ventas
     WHERE estado = 'activa' AND ${EN_RANGO("fecha_hora")}`,
    [desde, hasta]
  );
}

// Los 10 con más unidades (empate: más dinero, luego nombre).
function topProductos(desde, hasta) {
  return db.todos(
    `WITH vendidos AS (${VENDIDOS})
     SELECT p.id_producto, p.nombre, vs.unidades, ROUND(vs.total::numeric, 2) AS total
     FROM vendidos vs
     JOIN productos p ON p.id_producto = vs.id_producto
     ORDER BY vs.unidades DESC, vs.total DESC, p.nombre, p.id_producto
     LIMIT 10`,
    [desde, hasta]
  );
}

// Los 5 con menos unidades. Incluye los productos activos que no se vendieron
// (0 unidades) y los inactivos solo si se vendieron en el periodo.
function productosMenosVendidos(desde, hasta) {
  return db.todos(
    `WITH vendidos AS (${VENDIDOS})
     SELECT p.id_producto, p.nombre,
            COALESCE(vs.unidades, 0) AS unidades,
            ROUND(COALESCE(vs.total, 0)::numeric, 2) AS total
     FROM productos p
     LEFT JOIN vendidos vs ON vs.id_producto = p.id_producto
     WHERE p.activo = 1 OR vs.id_producto IS NOT NULL
     ORDER BY COALESCE(vs.unidades, 0) ASC, COALESCE(vs.total, 0) ASC, p.nombre, p.id_producto
     LIMIT 5`,
    [desde, hasta]
  );
}

// El Kardex solo tiene tipo entrada/salida: un ajuste es una salida con motivo
// "ajuste", y "salidas" son las demás salidas (ventas), sin contarlo dos veces.
function totalesMovimientos(desde, hasta) {
  return db.uno(
    `SELECT COUNT(*) FILTER (WHERE tipo = 'entrada') AS entradas_movimientos,
            COALESCE(SUM(cantidad) FILTER (WHERE tipo = 'entrada'), 0) AS entradas_unidades,
            COUNT(*) FILTER (WHERE tipo = 'salida' AND motivo <> 'ajuste') AS salidas_movimientos,
            COALESCE(SUM(cantidad) FILTER (WHERE tipo = 'salida' AND motivo <> 'ajuste'), 0) AS salidas_unidades,
            COUNT(*) FILTER (WHERE tipo = 'salida' AND motivo = 'ajuste') AS ajustes_movimientos,
            COALESCE(SUM(cantidad) FILTER (WHERE tipo = 'salida' AND motivo = 'ajuste'), 0) AS ajustes_unidades
     FROM movimientos_inventario
     WHERE ${EN_RANGO("fecha_hora")}`,
    [desde, hasta]
  );
}

// Un punto por día del rango, también los días sin ventas (total 0).
function ventasPorDia(desde, hasta) {
  return db.todos(
    `SELECT to_char(d.dia, 'YYYY-MM-DD') AS fecha,
            ROUND(COALESCE(SUM(v.total), 0)::numeric, 2) AS total,
            COUNT(v.id_venta) AS numero_ventas
     FROM generate_series($1::timestamp, $2::timestamp, interval '1 day') AS d(dia)
     LEFT JOIN ventas v
       ON v.estado = 'activa'
      AND v.fecha_hora >= d.dia + interval '5 hours'
      AND v.fecha_hora < d.dia + interval '1 day 5 hours'
     GROUP BY d.dia
     ORDER BY d.dia`,
    [desde, hasta]
  );
}

module.exports = { resumenVentas, topProductos, productosMenosVendidos, totalesMovimientos, ventasPorDia };
