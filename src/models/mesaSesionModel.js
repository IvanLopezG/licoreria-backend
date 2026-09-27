const crypto = require("crypto");
const db = require("../db/db");

// Sesiones de mesa del catálogo QR: una sesión = una ocupación de la mesa.
// Las funciones que cambian el estado reciben el client (cx) de la transacción
// del pedido, del cierre de cuenta o de la anulación, para que la sesión cambie
// junto con ellos o no cambie. revision sube con cada cambio visible para el
// cliente: el catálogo la usa como ETag del polling.

const AHORA_UTC = "date_trunc('second', now() AT TIME ZONE 'utc')";

const hashToken = (token) => crypto.createHash("sha256").update(token, "utf8").digest("hex");

// Sesión activa de la mesa, o una nueva. El llamador ya bloqueó la fila de la
// mesa (FOR UPDATE), así dos primeros pedidos simultáneos no abren dos sesiones.
async function activaOAbrir(id_mesa, cx) {
  const activa = await cx.uno("SELECT id_sesion FROM mesa_sesiones WHERE id_mesa = $1 AND estado = 'activa'", [id_mesa]);
  if (activa) return activa.id_sesion;
  const { id_sesion } = await cx.uno("INSERT INTO mesa_sesiones (id_mesa) VALUES ($1) RETURNING id_sesion", [id_mesa]);
  return id_sesion;
}

function subirRevision(id_sesion, cx = db) {
  return cx.ejecutar("UPDATE mesa_sesiones SET revision = revision + 1 WHERE id_sesion = $1", [id_sesion]);
}

// Cierre de cuenta: la sesión activa de la mesa queda cerrada con su factura.
async function cerrarActiva(id_mesa, id_factura, cx) {
  await cx.ejecutar(
    `UPDATE mesa_sesiones SET estado = 'cerrada', cerrada_en = ${AHORA_UTC}, id_factura = $2, revision = revision + 1
     WHERE id_mesa = $1 AND estado = 'activa'`,
    [id_mesa, id_factura]
  );
}

// Tras cancelar un pedido: si la sesión ya no tiene pedidos sin cobrar, se
// cancela. La mesa sigue ocupada (como antes), pero el siguiente pedido abre
// una sesión nueva: un cliente nuevo no entra en la sesión del anterior.
async function trasCancelarPedido(id_sesion, cx) {
  if (!id_sesion) return;
  await cx.ejecutar(
    `UPDATE mesa_sesiones
     SET revision = revision + 1,
         estado = CASE WHEN EXISTS (SELECT 1 FROM pedidos WHERE id_sesion = $1 AND id_venta IS NULL)
                       THEN estado ELSE 'cancelada' END,
         cerrada_en = CASE WHEN EXISTS (SELECT 1 FROM pedidos WHERE id_sesion = $1 AND id_venta IS NULL)
                           THEN cerrada_en ELSE ${AHORA_UTC} END
     WHERE id_sesion = $1 AND estado = 'activa'`,
    [id_sesion]
  );
}

// Anulación con reapertura de pedidos: la sesión de esa factura vuelve a estar
// activa, sin factura y marcada como reabierta. Si la venta es anterior a las
// sesiones (no hay sesión con esa factura), se abre una nueva sin tokens.
// Devuelve el id_sesion al que quedan ligados los pedidos reabiertos.
async function reabrirPorAnulacion({ id_factura, id_mesa }, cx) {
  // facturaModel.anular ya verificó que la mesa no tiene pedidos abiertos; una
  // sesión activa vacía que quede no debe impedir reabrir (índice único).
  await cx.ejecutar(
    `UPDATE mesa_sesiones SET estado = 'cancelada', cerrada_en = ${AHORA_UTC}, revision = revision + 1
     WHERE id_mesa = $1 AND estado = 'activa'`,
    [id_mesa]
  );
  const sesion = await cx.uno("SELECT id_sesion FROM mesa_sesiones WHERE id_factura = $1 FOR UPDATE", [id_factura]);
  if (!sesion) {
    const { id_sesion } = await cx.uno(
      "INSERT INTO mesa_sesiones (id_mesa, reabierta) VALUES ($1, 1) RETURNING id_sesion",
      [id_mesa]
    );
    return id_sesion;
  }
  await cx.ejecutar(
    `UPDATE mesa_sesiones SET estado = 'activa', cerrada_en = NULL, id_factura = NULL, reabierta = 1, revision = revision + 1
     WHERE id_sesion = $1`,
    [sesion.id_sesion]
  );
  return sesion.id_sesion;
}

// Anulación sin reapertura: la sesión sigue cerrada; el cliente deja de ver la
// factura (la vista pública revisa el estado de la factura).
function avisarFacturaAnulada(id_factura, cx) {
  return cx.ejecutar("UPDATE mesa_sesiones SET revision = revision + 1 WHERE id_factura = $1", [id_factura]);
}

// ---------- Tokens de sesión (uno por celular) ----------

// Devuelve el token en claro: es la única vez que existe fuera del celular.
async function crearToken(id_sesion, cx) {
  const token = crypto.randomBytes(32).toString("base64url");
  await cx.ejecutar("INSERT INTO mesa_sesion_tokens (id_sesion, token_hash) VALUES ($1, $2)", [id_sesion, hashToken(token)]);
  return token;
}

// Token + su sesión, o undefined. Busca por el hash (índice único) y además
// compara en tiempo constante.
async function buscarPorToken(token, cx = db) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return undefined;
  const hash = hashToken(token);
  const fila = await cx.uno(
    `SELECT t.id_token, t.token_hash, t.revocado_en, s.id_sesion, s.id_mesa, s.estado, s.cerrada_en, s.revision,
            s.id_factura, s.reabierta
     FROM mesa_sesion_tokens t
     JOIN mesa_sesiones s ON s.id_sesion = t.id_sesion
     WHERE t.token_hash = $1`,
    [hash]
  );
  if (!fila) return undefined;
  const iguales = crypto.timingSafeEqual(Buffer.from(fila.token_hash, "hex"), Buffer.from(hash, "hex"));
  return iguales ? fila : undefined;
}

function revocarToken(id_token) {
  return db.ejecutar(
    `UPDATE mesa_sesion_tokens SET revocado_en = ${AHORA_UTC} WHERE id_token = $1 AND revocado_en IS NULL`,
    [id_token]
  );
}

module.exports = {
  activaOAbrir,
  subirRevision,
  cerrarActiva,
  trasCancelarPedido,
  reabrirPorAnulacion,
  avisarFacturaAnulada,
  crearToken,
  buscarPorToken,
  revocarToken,
};
