// Pruebas de integración de las sesiones de mesa del catálogo QR (factura y
// estado de pedidos en el celular del cliente), por HTTP con la app real y un
// Postgres LOCAL desechable. Sin dependencias nuevas.
//
// Uso (base local sin SSL, p. ej. un Postgres de prueba en el puerto 55432):
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres PGSSLMODE=disable \
//     node scripts/prueba-sesiones-mesa.js
//
// Se niega a correr si DATABASE_URL no apunta a localhost/127.0.0.1 (nunca
// contra Supabase). Crea sus propios usuarios, producto y mesas con nombres
// aleatorios; no borra nada. Aplica schema.sql dos veces (idempotencia).
const crypto = require("crypto");

const url = process.env.DATABASE_URL || "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  // se rechaza abajo
}
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) || /supabase/i.test(url)) {
  console.error("DATABASE_URL debe apuntar a un Postgres local desechable (localhost/127.0.0.1). Nunca a Supabase.");
  process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";

// dotenv no sobrescribe variables ya definidas: el .env (Supabase) no se usa.
const db = require("../src/db/db");
const bcrypt = require("bcryptjs");
const usuarioModel = require("../src/models/usuarioModel");
const categoriaModel = require("../src/models/categoriaModel");
const facturaService = require("../src/services/facturaService");
const app = require("../src/app");

let base;
let fallos = 0;
let pasos = 0;
function verificar(condicion, descripcion, detalle) {
  pasos += 1;
  if (condicion) {
    console.log(`  ok  ${descripcion}`);
  } else {
    fallos += 1;
    console.log(`  FALLA  ${descripcion}${detalle === undefined ? "" : ` → ${JSON.stringify(detalle)}`}`);
  }
}
const titulo = (t) => console.log(`\n== ${t}`);

async function pedir(metodo, ruta, { jwt, sesion, body, headers = {} } = {}) {
  const h = { ...headers };
  if (jwt) h.Authorization = `Bearer ${jwt}`;
  if (sesion) h["X-Sesion-Token"] = sesion;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(base + ruta, { method: metodo, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const tipo = res.headers.get("content-type") || "";
  let cuerpo = null;
  if (tipo.includes("json")) cuerpo = await res.json();
  else if (res.status !== 304) cuerpo = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body: cuerpo };
}

const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
const idSesionDe = async (token) =>
  (await db.uno("SELECT id_sesion FROM mesa_sesion_tokens WHERE token_hash = $1", [hash(token)])).id_sesion;

async function main() {
  titulo("9. Migración: schema.sql dos veces y datos existentes");
  await db.inicializarEsquema();
  await db.inicializarEsquema();
  verificar(true, "schema.sql aplicado dos veces sin error");
  await facturaService.asegurarDatosIniciales();

  const sufijo = crypto.randomBytes(3).toString("hex");
  const clave = "Prueba123!";
  const password_hash = bcrypt.hashSync(clave, 4);
  for (const rol of ["administrador", "cajero", "mesero"]) {
    await usuarioModel.crear({ nombre: `${rol} ${sufijo}`, usuario_login: `${rol}_${sufijo}`, password_hash, rol });
  }

  const servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  const login = async (rol) =>
    (await pedir("POST", "/api/auth/login", { body: { usuario_login: `${rol}_${sufijo}`, password: clave } })).body.token;
  const admin = await login("administrador");
  const cajero = await login("cajero");
  const mesero = await login("mesero");

  const categoria = (await categoriaModel.buscarPorNombre("Licor")) || (await categoriaModel.crear({ nombre: "Licor" }));
  const prod = (await pedir("POST", "/api/productos", {
    jwt: admin,
    body: { nombre: `Ron ${sufijo}`, id_categoria: categoria.id_categoria, precio: 10000, unidad_medida: "botella", stock_actual: 500, umbral_alerta: 1 },
  })).body;
  const numeroBase = 7000 + Math.floor(Math.random() * 2000);
  const crearMesa = async (n) => {
    const m = (await pedir("POST", "/api/mesas", { jwt: admin, body: { numero: n } })).body;
    return { ...m, qr: m.codigo_qr_token };
  };
  const mesa = await crearMesa(numeroBase);
  const item = (cantidad = 1) => ({ items: [{ id_producto: prod.id_producto, cantidad }] });

  // Datos "existentes": un pedido abierto sin sesión (como antes de la
  // migración) en una mesa ocupada; al aplicar schema.sql queda en una sesión activa.
  const mesaVieja = await crearMesa(numeroBase + 1);
  const { id_pedido: pedidoViejo } = await db.uno(
    "INSERT INTO pedidos (id_mesa) VALUES ($1) RETURNING id_pedido",
    [mesaVieja.id_mesa]
  );
  await db.ejecutar(
    "INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario) VALUES ($1, $2, 1, 10000)",
    [pedidoViejo, prod.id_producto]
  );
  await db.ejecutar("UPDATE mesas SET estado = 'ocupada' WHERE id_mesa = $1", [mesaVieja.id_mesa]);
  await db.inicializarEsquema();
  await db.inicializarEsquema();
  const migrado = await db.uno(
    "SELECT p.id_sesion, s.estado FROM pedidos p JOIN mesa_sesiones s ON s.id_sesion = p.id_sesion WHERE p.id_pedido = $1",
    [pedidoViejo]
  );
  verificar(migrado && migrado.estado === "activa", "pedido abierto existente queda en una sesión activa", migrado);
  const activasVieja = await db.uno("SELECT COUNT(*) AS n FROM mesa_sesiones WHERE id_mesa = $1 AND estado = 'activa'", [mesaVieja.id_mesa]);
  verificar(activasVieja.n === 1, "una sola sesión activa aunque la migración corra varias veces", activasVieja);
  const cierreViejo = await pedir("POST", `/api/mesas/${mesaVieja.id_mesa}/cerrar-cuenta`, { jwt: cajero, body: {} });
  verificar(cierreViejo.status === 201, "la mesa con datos migrados se cobra normalmente", cierreViejo.status);

  titulo("1. Cliente A pide, recibe token y ve el estado; entregado cambia la revisión (ETag/304)");
  const catalogoAntes = await pedir("GET", `/api/catalogo/${mesa.qr}`);
  verificar(catalogoAntes.status === 200, "catálogo por QR responde 200");
  const pA = await pedir("POST", `/api/catalogo/${mesa.qr}/pedidos`, { body: item(2) });
  const tokenA = pA.body.token_sesion;
  verificar(pA.status === 201 && typeof tokenA === "string" && tokenA.length >= 43, "primer pedido de A → 201 con token_sesion");
  verificar(!("id_sesion" in pA.body), "la respuesta del pedido no expone id_sesion");
  const pA2 = await pedir("POST", `/api/catalogo/${mesa.qr}/pedidos`, { body: item(1), sesion: tokenA });
  verificar(pA2.status === 201 && !("token_sesion" in pA2.body), "segundo pedido de A con su token → sin token nuevo");

  let eA = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenA });
  verificar(eA.status === 200 && eA.body.estado === "activa" && eA.body.pedidos.length === 2, "A ve su sesión activa con 2 pedidos", eA.body);
  verificar(eA.headers.get("cache-control") === "no-store", "Cache-Control: no-store");
  const etag1 = eA.headers.get("etag");
  const e304 = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenA, headers: { "If-None-Match": etag1 } });
  verificar(e304.status === 304 && e304.body === null, "mismo ETag → 304 sin cuerpo");
  verificar(!JSON.stringify(eA.body).match(/"id_(pedido|mesa|sesion|venta|factura|usuario)"/), "la vista pública no trae ids internos");

  const idPedidoA = pA.body.id_pedido;
  const ent = await pedir("PUT", `/api/pedidos/${idPedidoA}/entregado`, { jwt: mesero });
  verificar(ent.status === 200 && ent.body.estado === "entregado", "mesero marca entregado → 200");
  eA = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenA, headers: { "If-None-Match": etag1 } });
  verificar(eA.status === 200 && eA.body.pedidos[0].estado === "entregado", "A ve el pedido entregado (ETag viejo → 200)");
  verificar(eA.headers.get("etag") !== etag1, "la revisión cambió");

  titulo("6. Varios celulares en la misma mesa");
  const pC = await pedir("POST", `/api/catalogo/${mesa.qr}/pedidos`, { body: item(1) });
  const tokenC = pC.body.token_sesion;
  verificar(pC.status === 201 && tokenC && tokenC !== tokenA, "celular C pide → recibe su propio token");
  const eC = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenC });
  eA = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenA });
  verificar(eC.body.pedidos.length === 3 && eA.body.pedidos.length === 3, "A y C ven la cuenta completa (3 pedidos)");
  const sinPedido = await pedir("GET", "/api/catalogo/sesion/estado");
  verificar(sinPedido.status === 401, "celular sin pedidos (sin token) no ve nada → 401");
  const histSinToken = await pedir("GET", `/api/catalogo/${mesa.qr}/pedidos`);
  verificar(histSinToken.status === 200 && Array.isArray(histSinToken.body) && histSinToken.body.length === 0, "historial por QR sin token → []");
  const histConToken = await pedir("GET", `/api/catalogo/${mesa.qr}/pedidos`, { sesion: tokenA });
  verificar(histConToken.body.length === 3, "historial por QR con token de la sesión activa → sus pedidos");

  titulo("2. Cierre de cuenta: A ve el resumen y el PDF; la mesa queda libre");
  const pdfAntes = await pedir("GET", "/api/catalogo/sesion/factura.pdf", { sesion: tokenA });
  verificar(pdfAntes.status === 404, "PDF antes del cierre → 404");
  const cierre = await pedir("POST", `/api/mesas/${mesa.id_mesa}/cerrar-cuenta`, {
    jwt: cajero,
    body: { cliente: { nombre: "Ana Pérez", tipo_doc: "CC", num_doc: "1098765432" } },
  });
  verificar(cierre.status === 201 && cierre.body.factura, "cajero cierra la cuenta → 201 con factura");
  const numeroFactura1 = cierre.body.factura.numero_completo;
  const mesaTras = (await pedir("GET", `/api/mesas/${mesa.id_mesa}`, { jwt: cajero })).body;
  verificar(mesaTras.estado === "libre", "la mesa queda libre");
  eA = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenA });
  verificar(eA.body.estado === "cerrada" && eA.body.factura && eA.body.factura.numero === numeroFactura1, "A ve la factura del cierre", eA.body.factura);
  verificar(eA.body.factura.total === cierre.body.factura.total, "mismo total que la factura");
  verificar(eA.body.factura.cliente.documento === "CC *******432", "documento enmascarado en pantalla", eA.body.factura.cliente);
  verificar(!JSON.stringify(eA.body).includes("1098765432"), "el documento completo no aparece en la vista");
  verificar(typeof eA.body.vence_en === "string", "trae vence_en");
  const pdfA = await pedir("GET", "/api/catalogo/sesion/factura.pdf", { sesion: tokenA });
  verificar(pdfA.status === 200 && pdfA.headers.get("content-type") === "application/pdf" && pdfA.body.slice(0, 4).toString() === "%PDF", "A descarga el PDF");
  const pdfSinToken = await pedir("GET", "/api/catalogo/sesion/factura.pdf");
  verificar(pdfSinToken.status === 401, "PDF sin token → 401");

  titulo("3. Cliente B tras el cierre: catálogo limpio, sesión nueva, sin cruces con A");
  const histB = await pedir("GET", `/api/catalogo/${mesa.qr}/pedidos`);
  verificar(histB.body.length === 0, "B sin token no ve pedidos");
  const histBconA = await pedir("GET", `/api/catalogo/${mesa.qr}/pedidos`, { sesion: tokenA });
  verificar(histBconA.body.length === 0, "el token de A (sesión cerrada) no da el historial de la mesa");
  const pB = await pedir("POST", `/api/catalogo/${mesa.qr}/pedidos`, { body: item(4), sesion: tokenA });
  const tokenB = pB.body.token_sesion;
  verificar(pB.status === 201 && tokenB && tokenB !== tokenA, "B pide (aun enviando el token viejo) → token nuevo de otra sesión");
  verificar((await idSesionDe(tokenB)) !== (await idSesionDe(tokenA)), "sesión de B distinta a la de A");
  const eB = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenB });
  verificar(eB.body.estado === "activa" && eB.body.pedidos.length === 1 && eB.body.factura === null, "B ve solo su pedido, sin factura de A");
  eA = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenA });
  verificar(eA.body.estado === "cerrada" && eA.body.pedidos.length === 3 && eA.body.factura.numero === numeroFactura1, "A sigue viendo solo su sesión, nada de B");

  titulo("5. Anulación con reapertura");
  // B está ocupando la mesa: reabrir debe negarse como antes (409).
  const idFactura1 = cierre.body.factura.id_factura;
  const anularOcupada = await pedir("POST", `/api/facturas/${idFactura1}/anular`, {
    jwt: admin, body: { motivo: "Prueba de anulación con mesa ocupada", reabrir_pedidos: true },
  });
  verificar(anularOcupada.status === 409, "reabrir con la mesa ocupada por otro cliente → 409 (como antes)");
  const cierreB = await pedir("POST", `/api/mesas/${mesa.id_mesa}/cerrar-cuenta`, { jwt: cajero, body: {} });
  verificar(cierreB.status === 201, "se cierra la cuenta de B");
  const anular = await pedir("POST", `/api/facturas/${idFactura1}/anular`, {
    jwt: admin, body: { motivo: "Error en la cuenta de la mesa", reabrir_pedidos: true },
  });
  verificar(anular.status === 200 && anular.body.estado === "anulada", "administrador anula con reapertura → 200");
  eA = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenA });
  verificar(eA.status === 200 && eA.body.estado === "activa" && eA.body.reabierta === true && eA.body.factura === null, "A ve 'cuenta reabierta' sin factura", eA.body);
  // El número interno puede ser "5": se busca como valor de un campo, no como texto suelto.
  const textoA = JSON.stringify(eA.body);
  verificar(
    !textoA.includes(`"numero":"${numeroFactura1}"`) && !textoA.includes("emisor") && !textoA.includes("Ana Pérez"),
    "ningún dato de la factura anulada (número, emisor ni cliente)"
  );
  const pdfAnulada = await pedir("GET", "/api/catalogo/sesion/factura.pdf", { sesion: tokenA });
  verificar(pdfAnulada.status === 404 || pdfAnulada.status === 410, "PDF de la factura anulada no disponible", pdfAnulada.status);
  const eBtrasAnular = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenB });
  verificar(eBtrasAnular.body.estado === "cerrada" && eBtrasAnular.body.factura.numero === cierreB.body.factura.numero_completo, "B no se ve afectado por la reapertura de A");
  const cierre2 = await pedir("POST", `/api/mesas/${mesa.id_mesa}/cerrar-cuenta`, { jwt: cajero, body: {} });
  verificar(cierre2.status === 201, "se cierra de nuevo la cuenta reabierta");
  eA = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenA });
  verificar(eA.body.estado === "cerrada" && eA.body.factura.numero === cierre2.body.factura.numero_completo && eA.body.reabierta === false, "A ve la factura nueva");
  verificar((await pedir("GET", "/api/catalogo/sesion/factura.pdf", { sesion: tokenA })).status === 200, "A descarga el PDF nuevo");

  titulo("5b. Anulación sin reapertura");
  const anularB = await pedir("POST", `/api/facturas/${cierreB.body.factura.id_factura}/anular`, {
    jwt: admin, body: { motivo: "Anulación sin reabrir pedidos" },
  });
  verificar(anularB.status === 200, "anular sin reapertura → 200");
  const eB2 = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenB });
  verificar(eB2.body.factura === null && eB2.body.factura_anulada === true, "B ve 'factura anulada' sin datos");
  verificar([404, 410].includes((await pedir("GET", "/api/catalogo/sesion/factura.pdf", { sesion: tokenB })).status), "PDF anulado no disponible");

  titulo("4. Vencimiento y 'Listo'");
  await db.ejecutar(
    "UPDATE mesa_sesiones SET cerrada_en = cerrada_en - interval '31 minutes' WHERE id_sesion = $1",
    [await idSesionDe(tokenA)]
  );
  const vencida = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenA });
  verificar(vencida.status === 410, "31 minutos después del cierre → 410", vencida.status);
  verificar((await pedir("GET", "/api/catalogo/sesion/factura.pdf", { sesion: tokenA })).status === 410, "PDF vencido → 410");
  const listo = await pedir("POST", "/api/catalogo/sesion/listo", { sesion: tokenB });
  verificar(listo.status === 200, "B toca 'Listo' → 200");
  verificar((await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenB })).status === 410, "tras 'Listo' → 410");
  const rev = await db.uno("SELECT revocado_en FROM mesa_sesion_tokens WHERE token_hash = $1", [hash(tokenB)]);
  verificar(rev.revocado_en !== null, "token de B revocado en la base");
  verificar((await pedir("POST", "/api/catalogo/sesion/listo", { sesion: tokenB })).status === 410, "'Listo' otra vez → 410");

  titulo("7. Tokens inválidos, ajenos o en la URL");
  const falso = crypto.randomBytes(32).toString("base64url");
  const r1 = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: falso });
  verificar(r1.status === 401 && r1.body.error === "Sesión no válida.", "token inexistente → 401 genérico");
  const r2 = await pedir("GET", "/api/catalogo/sesion/estado", { sesion: "corto" });
  verificar(r2.status === 401 && r2.body.error === "Sesión no válida.", "token malformado → mismo 401");
  const tokenC2 = tokenC; // C: misma sesión que A (vencida)
  verificar((await pedir("GET", "/api/catalogo/sesion/estado", { sesion: tokenC2 })).status === 410, "token de otro celular de la sesión vencida → 410");
  const enUrl = await pedir("GET", `/api/catalogo/sesion/estado?token=${tokenC}&token_sesion=${tokenC}&X-Sesion-Token=${tokenC}`);
  verificar(enUrl.status === 401, "token en la URL no se acepta → 401");
  const pdfUrl = await pedir("GET", `/api/catalogo/sesion/factura.pdf?token_sesion=${tokenC}`);
  verificar(pdfUrl.status === 401, "PDF con token en la URL → 401");
  const mesaOtra = await crearMesa(numeroBase + 2);
  const pOtra = await pedir("POST", `/api/catalogo/${mesaOtra.qr}/pedidos`, { body: item(1) });
  const histCruzado = await pedir("GET", `/api/catalogo/${mesa.qr}/pedidos`, { sesion: pOtra.body.token_sesion });
  verificar(histCruzado.body.length === 0, "token de otra mesa no da el historial de esta mesa");

  titulo("Cancelar todos los pedidos cancela la sesión (el siguiente cliente no entra en ella)");
  const idPedidoOtra = pOtra.body.id_pedido;
  const cancel = await pedir("DELETE", `/api/pedidos/${idPedidoOtra}`, { jwt: cajero });
  verificar(cancel.status === 200, "cajero cancela el único pedido → 200");
  verificar((await pedir("GET", "/api/catalogo/sesion/estado", { sesion: pOtra.body.token_sesion })).status === 410, "la sesión cancelada → 410");
  const pNuevo = await pedir("POST", `/api/catalogo/${mesaOtra.qr}/pedidos`, { body: item(1), sesion: pOtra.body.token_sesion });
  verificar(pNuevo.body.token_sesion && (await idSesionDe(pNuevo.body.token_sesion)) !== (await idSesionDe(pOtra.body.token_sesion)), "el siguiente pedido abre una sesión nueva");

  titulo("8. Regresión de lo que usa la app Android");
  const pedidos = await pedir("GET", `/api/pedidos?id_mesa=${mesaOtra.id_mesa}`, { jwt: mesero });
  const claves = Object.keys(pedidos.body[0]).join(",");
  verificar(claves === "id_pedido,id_mesa,id_venta,estado,notificado,fecha_hora,mesa_numero,items", "GET /api/pedidos: mismos campos y orden", claves);
  verificar((await pedir("GET", "/api/mesas", { jwt: mesero })).status === 200, "GET /api/mesas (mesero) → 200");
  verificar((await pedir("GET", `/api/mesas/${mesa.id_mesa}/qr`, { jwt: mesero })).status === 403, "QR de mesa (mesero) → 403");
  verificar((await pedir("POST", `/api/mesas/${mesaOtra.id_mesa}/cerrar-cuenta`, { jwt: mesero })).status === 403, "cerrar cuenta (mesero) → 403");
  verificar((await pedir("DELETE", `/api/pedidos/${pNuevo.body.id_pedido}`, { jwt: mesero })).status === 403, "cancelar pedido (mesero) → 403");
  verificar((await pedir("POST", `/api/facturas/${cierre2.body.factura.id_factura}/anular`, { jwt: cajero, body: { motivo: "Intento de cajero no permitido" } })).status === 403, "anular (cajero) → 403");
  verificar((await pedir("GET", `/api/facturas/${cierre2.body.factura.id_factura}/pdf`, { jwt: cajero })).status === 200, "PDF interno (cajero) → 200");
  const cierre3 = await pedir("POST", `/api/mesas/${mesaOtra.id_mesa}/cerrar-cuenta`, { jwt: cajero, body: {} });
  const clavesCierre = Object.keys(cierre3.body).join(",");
  verificar(cierre3.status === 201 && !clavesCierre.includes("sesion"), "cerrar cuenta → 201 sin campos de sesión", clavesCierre);

  servidor.close();
  console.log(`\n${pasos - fallos}/${pasos} verificaciones correctas.`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
