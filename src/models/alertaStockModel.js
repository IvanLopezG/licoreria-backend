const db = require("../db/db");

// Alertas de stock: todo se calcula en SQL, producto por producto.
//
// $1 = desde y $2 = hasta: días de Colombia ("AAAA-MM-DD", inclusivos) de la
// ventana de ventas, con el mismo criterio que models/reporteModel.js (el día D
// va de D 05:00 a D+1 05:00 en UTC). $3 = ventana_dias, $4 =
// cobertura_alerta_dias, $5 = dias_objetivo.
//
// Para no arrastrar errores de redondeo, las comparaciones y la cantidad
// sugerida se hacen con enteros:
//   dias_cobertura < cobertura  ⇔  stock * ventana < cobertura * unidades
//   promedio * objetivo - stock  =  (unidades * objetivo) / ventana - stock
// promedio_diario y dias_cobertura se redondean solo para mostrarlos.
const ALERTAS = `
  WITH vendidos AS (
    SELECT vd.id_producto, SUM(vd.cantidad) AS unidades
    FROM venta_detalle vd
    JOIN ventas v ON v.id_venta = vd.id_venta
    WHERE v.estado = 'activa'
      AND v.fecha_hora >= ($1::date + interval '5 hours')
      AND v.fecha_hora < ($2::date + interval '1 day 5 hours')
    GROUP BY vd.id_producto
  ),
  calculo AS (
    SELECT p.id_producto, p.nombre, p.unidad_medida, c.nombre AS categoria_nombre,
           p.stock_actual, p.umbral_alerta,
           COALESCE(vs.unidades, 0) AS unidades_vendidas
    FROM productos p
    LEFT JOIN vendidos vs ON vs.id_producto = p.id_producto
    LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
    WHERE p.activo = 1
  ),
  con_estado AS (
    SELECT *,
           CASE
             WHEN stock_actual <= 0 THEN 'agotado'
             WHEN stock_actual <= umbral_alerta THEN 'bajo_minimo'
             WHEN unidades_vendidas > 0
                  AND stock_actual::numeric * $3::integer < $4::numeric * unidades_vendidas THEN 'por_agotarse'
             ELSE 'ok'
           END AS estado
    FROM calculo
  )
  SELECT id_producto, nombre, categoria_nombre, unidad_medida, stock_actual, umbral_alerta, estado,
         unidades_vendidas,
         ROUND(unidades_vendidas::numeric / $3::integer, 2) AS promedio_diario,
         CASE WHEN unidades_vendidas > 0
              THEN ROUND(stock_actual::numeric * $3::integer / unidades_vendidas, 1) END AS dias_cobertura,
         GREATEST(0, CEIL(unidades_vendidas::numeric * $5::integer / $3::integer - stock_actual))::integer AS cantidad_sugerida
  FROM con_estado
  WHERE estado <> 'ok'
  ORDER BY CASE estado WHEN 'agotado' THEN 1 WHEN 'bajo_minimo' THEN 2 ELSE 3 END,
           unidades_vendidas DESC, nombre, id_producto`;

function listar({ desde, hasta, ventana_dias, cobertura_alerta_dias, dias_objetivo }) {
  return db.todos(ALERTAS, [desde, hasta, ventana_dias, cobertura_alerta_dias, dias_objetivo]);
}

module.exports = { listar };
