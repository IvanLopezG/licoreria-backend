const db = require("../db/db");

const SELECT_PRODUCTO = `
  SELECT p.*, c.nombre AS categoria_nombre
  FROM productos p
  JOIN categorias c ON c.id_categoria = p.id_categoria
`;

// Columnas que se escriben al crear y al editar (stock_actual solo al crear:
// después cambia únicamente vía entradas/salidas).
const COLUMNAS_EDITABLES = [
  "id_categoria", "nombre", "unidad_medida", "precio", "umbral_alerta",
  "tasa_iva_bps", "tasa_inc_bps", "es_bebida_alcoholica",
  "costo", "codigo_barras", "marca", "volumen_ml", "grado_alcohol", "descripcion", "activo",
];

async function crear(datos) {
  const columnas = [...COLUMNAS_EDITABLES, "stock_actual"];
  const { id_producto } = await db.uno(
    `INSERT INTO productos (${columnas.join(", ")})
     VALUES (${columnas.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING id_producto`,
    columnas.map((c) => datos[c])
  );
  return buscarPorId(id_producto);
}

async function editar(id_producto, datos) {
  await db.ejecutar(
    `UPDATE productos
     SET ${COLUMNAS_EDITABLES.map((c, i) => `${c} = $${i + 1}`).join(", ")}
     WHERE id_producto = $${COLUMNAS_EDITABLES.length + 1}`,
    [...COLUMNAS_EDITABLES.map((c) => datos[c]), id_producto]
  );
  return buscarPorId(id_producto);
}

// ¿Otro producto ya usa este código de barras / SKU?
async function codigoEnUso(codigo_barras, excluirId = null) {
  return !!(await db.uno(
    "SELECT 1 FROM productos WHERE codigo_barras = $1 AND id_producto IS DISTINCT FROM $2",
    [codigo_barras, excluirId]
  ));
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

module.exports = { crear, editar, buscarPorId, buscarPorIdParaActualizar, listar, existeCategoria, ajustarStock, codigoEnUso };
