const db = require("../db/db");

function crear(datos) {
  const stmt = db.prepare(`
    INSERT INTO productos (id_categoria, nombre, unidad_medida, precio, stock_actual, umbral_alerta,
                           tasa_iva_bps, tasa_inc_bps, es_bebida_alcoholica)
    VALUES (@id_categoria, @nombre, @unidad_medida, @precio, @stock_actual, @umbral_alerta,
            @tasa_iva_bps, @tasa_inc_bps, @es_bebida_alcoholica)
  `);
  const info = stmt.run(datos);
  return buscarPorId(info.lastInsertRowid);
}

function editar(id_producto, datos) {
  db.prepare(`
    UPDATE productos
    SET id_categoria = @id_categoria, nombre = @nombre, unidad_medida = @unidad_medida,
        precio = @precio, umbral_alerta = @umbral_alerta, tasa_iva_bps = @tasa_iva_bps,
        tasa_inc_bps = @tasa_inc_bps, es_bebida_alcoholica = @es_bebida_alcoholica
    WHERE id_producto = @id_producto
  `).run({ id_producto, ...datos });
  return buscarPorId(id_producto);
}

function buscarPorId(id_producto) {
  return db
    .prepare(
      `
    SELECT p.*, c.nombre AS categoria_nombre
    FROM productos p
    JOIN categorias c ON c.id_categoria = p.id_categoria
    WHERE p.id_producto = ?
  `
    )
    .get(id_producto);
}

function listar() {
  return db
    .prepare(
      `
    SELECT p.*, c.nombre AS categoria_nombre
    FROM productos p
    JOIN categorias c ON c.id_categoria = p.id_categoria
    ORDER BY p.nombre
  `
    )
    .all();
}

function existeCategoria(id_categoria) {
  return !!db.prepare("SELECT 1 FROM categorias WHERE id_categoria = ?").get(id_categoria);
}

function ajustarStock(id_producto, delta) {
  db.prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?").run(delta, id_producto);
  return buscarPorId(id_producto);
}

module.exports = { crear, editar, buscarPorId, listar, existeCategoria, ajustarStock };
