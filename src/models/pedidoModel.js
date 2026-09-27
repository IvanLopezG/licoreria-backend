const db = require("../db/db");
const mesaModel = require("./mesaModel");
const mesaSesionModel = require("./mesaSesionModel");

// Columnas explícitas: id_sesion es interno y no sale en el JSON (la app
// Android y el catálogo reciben exactamente los mismos campos que antes).
const COLUMNAS_PEDIDO = "ped.id_pedido, ped.id_mesa, ped.id_venta, ped.estado, ped.notificado, ped.fecha_hora";

function itemsDelPedido(id_pedido, cx = db) {
  return cx.todos(
    `SELECT pd.*, p.nombre AS producto_nombre
     FROM pedido_detalle pd
     JOIN productos p ON p.id_producto = pd.id_producto
     WHERE pd.id_pedido = $1
     ORDER BY pd.id_pedido_detalle`,
    [id_pedido]
  );
}

// RF-12: el pedido queda asociado a la mesa del QR escaneado y, si la mesa
// estaba libre, pasa a ocupada; todo en una sola transacción. También queda
// en la sesión activa de la mesa (se abre con el primer pedido) y, si el
// celular aún no tiene un token válido de esa sesión (token_sesion), recibe
// uno nuevo en el campo token_sesion de la respuesta.
function crear({ id_mesa, items, token_sesion }) {
  return db.conTransaccion(async (cx) => {
    // Bloquea la mesa: dos primeros pedidos simultáneos no abren dos sesiones.
    await cx.uno("SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE", [id_mesa]);
    const id_sesion = await mesaSesionModel.activaOAbrir(id_mesa, cx);

    const { id_pedido } = await cx.uno(
      "INSERT INTO pedidos (id_mesa, id_sesion) VALUES ($1, $2) RETURNING id_pedido",
      [id_mesa, id_sesion]
    );

    for (const item of items) {
      await cx.ejecutar(
        `INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [id_pedido, item.id_producto, item.cantidad, item.precio_unitario]
      );
    }

    await mesaModel.actualizarEstado(id_mesa, "ocupada", cx);
    await mesaSesionModel.subirRevision(id_sesion, cx);

    const actual = token_sesion ? await mesaSesionModel.buscarPorToken(token_sesion, cx) : undefined;
    const vigente = actual && !actual.revocado_en && actual.id_sesion === id_sesion;
    const pedido = await buscarPorId(id_pedido, cx);
    return vigente ? pedido : { ...pedido, token_sesion: await mesaSesionModel.crearToken(id_sesion, cx) };
  });
}

async function buscarPorId(id_pedido, cx = db) {
  const pedido = await cx.uno(
    `SELECT ${COLUMNAS_PEDIDO}, m.numero AS mesa_numero
     FROM pedidos ped
     JOIN mesas m ON m.id_mesa = ped.id_mesa
     WHERE ped.id_pedido = $1`,
    [id_pedido]
  );
  if (!pedido) return null;
  return { ...pedido, items: await itemsDelPedido(id_pedido, cx) };
}

async function listar({ estado, id_mesa } = {}) {
  const f = db.filtros();
  if (estado) f.agregar("ped.estado = ?", estado);
  if (id_mesa) f.agregar("ped.id_mesa = ?", id_mesa);

  const pedidos = await db.todos(
    `SELECT ${COLUMNAS_PEDIDO}, m.numero AS mesa_numero
     FROM pedidos ped
     JOIN mesas m ON m.id_mesa = ped.id_mesa
     WHERE 1 = 1${f.where()}
     ORDER BY ped.fecha_hora ASC, ped.id_pedido ASC`,
    f.params
  );
  for (const pedido of pedidos) pedido.items = await itemsDelPedido(pedido.id_pedido);
  return pedidos;
}

// Una sola sentencia: el pedido y la revisión de su sesión cambian juntos.
async function marcarEntregado(id_pedido) {
  await db.ejecutar(
    `WITH p AS (UPDATE pedidos SET estado = 'entregado' WHERE id_pedido = $1 RETURNING id_sesion)
     UPDATE mesa_sesiones SET revision = revision + 1 WHERE id_sesion IN (SELECT id_sesion FROM p)`,
    [id_pedido]
  );
  return buscarPorId(id_pedido);
}

// No hay ON DELETE CASCADE en el esquema: se borra el detalle antes que el
// pedido, en la misma transacción, para no dejar líneas huérfanas.
function cancelar(id_pedido) {
  return db.conTransaccion(async (cx) => {
    const { id_sesion } = (await cx.uno("SELECT id_sesion FROM pedidos WHERE id_pedido = $1", [id_pedido])) || {};
    // Un pedido reabierto por anulación de factura sigue referenciado desde las
    // líneas de la venta anulada; se suelta esa referencia para poder borrarlo.
    await cx.ejecutar(
      `UPDATE venta_detalle SET id_pedido_detalle = NULL
       WHERE id_pedido_detalle IN (SELECT id_pedido_detalle FROM pedido_detalle WHERE id_pedido = $1)`,
      [id_pedido]
    );
    await cx.ejecutar("DELETE FROM pedido_detalle WHERE id_pedido = $1", [id_pedido]);
    await cx.ejecutar("DELETE FROM pedidos WHERE id_pedido = $1", [id_pedido]);
    await mesaSesionModel.trasCancelarPedido(id_sesion, cx);
  });
}

// Pedidos de una sesión, con sus ítems (vista pública del cliente).
async function listarPorSesion(id_sesion) {
  const pedidos = await db.todos(
    `SELECT id_pedido, estado, fecha_hora FROM pedidos WHERE id_sesion = $1 ORDER BY fecha_hora ASC, id_pedido ASC`,
    [id_sesion]
  );
  for (const pedido of pedidos) pedido.items = await itemsDelPedido(pedido.id_pedido);
  return pedidos;
}

module.exports = { crear, buscarPorId, listar, listarPorSesion, marcarEntregado, cancelar };
