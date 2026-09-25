const db = require("../db/db");

const SELECT_PRODUCTO = `
  SELECT p.*, c.nombre AS categoria_nombre
  FROM productos p
  JOIN categorias c ON c.id_categoria = p.id_categoria
`;

async function crear(datos) {
  const { id_producto } = await db.uno(
    `INSERT INTO productos (id_categoria, nombre, unidad_medida, precio, stock_actual, umbral_alerta,
                            tasa_iva_bps, tasa_inc_bps, es_bebida_alcoholica)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id_producto`,
    [
      datos.id_categoria,
      datos.nombre,
      datos.unidad_medida,
      datos.precio,
      datos.stock_actual,
      datos.umbral_alerta,
      datos.tasa_iva_bps,
      datos.tasa_inc_bps,
      datos.es_bebida_alcoholica,
    ]
  );
  return buscarPorId(id_producto);
}

async function editar(id_producto, datos) {
  await db.ejecutar(
    `UPDATE productos
     SET id_categoria = $1, nombre = $2, unidad_medida = $3, precio = $4, umbral_alerta = $5,
         tasa_iva_bps = $6, tasa_inc_bps = $7, es_bebida_alcoholica = $8
     WHERE id_producto = $9`,
    [
      datos.id_categoria,
      datos.nombre,
      datos.unidad_medida,
      datos.precio,
      datos.umbral_alerta,
      datos.tasa_iva_bps,
      datos.tasa_inc_bps,
      datos.es_bebida_alcoholica,
      id_producto,
    ]
  );
  return buscarPorId(id_producto);
}

function buscarPorId(id_producto, cx = db) {
  return cx.uno(`${SELECT_PRODUCTO} WHERE p.id_producto = $1`, [id_producto]);
}

// Bloquea la fila del producto hasta el fin de la transacción: dos ventas
// simultáneas del mismo producto no pueden leer el mismo stock y sobrevender.
function buscarPorIdParaActualizar(id_producto, cx) {
  return cx.uno(`${SELECT_PRODUCTO} WHERE p.id_producto = $1 FOR UPDATE OF p`, [id_producto]);
}

// COLLATE "C": mismo orden binario que SQLite.
function listar() {
  return db.todos(`${SELECT_PRODUCTO} ORDER BY p.nombre COLLATE "C", p.id_producto`);
}

async function existeCategoria(id_categoria) {
  return !!(await db.uno("SELECT 1 FROM categorias WHERE id_categoria = $1", [id_categoria]));
}

async function ajustarStock(id_producto, delta, cx = db) {
  await cx.ejecutar("UPDATE productos SET stock_actual = stock_actual + $1 WHERE id_producto = $2", [delta, id_producto]);
  return buscarPorId(id_producto, cx);
}

module.exports = { crear, editar, buscarPorId, buscarPorIdParaActualizar, listar, existeCategoria, ajustarStock };
