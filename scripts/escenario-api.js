// Recorre con curl los flujos de las 19 historias de usuario (más facturación)
// contra un backend en marcha y guarda cada respuesta en muestras/<carpeta>/.
// Sirve para comparar el backend SQLite con el de Postgres (comparar-muestras.js).
//
// Uso: API_BASE=http://localhost:3000 API_ADMIN_PASSWORD=... node scripts/escenario-api.js <carpeta>
// La base debe estar recién creada (solo el seed), para que los ids coincidan.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const BASE = process.env.API_BASE || "http://localhost:3000";
const ADMIN_LOGIN = process.env.API_ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.API_ADMIN_PASSWORD;
const carpeta = process.argv[2];
if (!carpeta || !ADMIN_PASSWORD) {
  console.error("Uso: API_ADMIN_PASSWORD=... node scripts/escenario-api.js <carpeta>");
  process.exit(1);
}

const DESTINO = path.join(__dirname, "..", "muestras", carpeta);
fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(DESTINO, { recursive: true });
const TMP = path.join(os.tmpdir(), `escenario-${process.pid}.bin`);

// Contraseñas de los usuarios que crea el propio escenario (desechables).
const CLAVE_ESCENARIO = "Escenario123!";
const HOY = new Date().toISOString().slice(0, 10);

let paso = 0;

function curl(nombre, metodo, ruta, { body, token } = {}) {
  const args = ["-s", "-X", metodo, "-o", TMP, "-w", "%{http_code}|%{content_type}", `${BASE}${ruta}`];
  if (token) args.push("-H", `Authorization: Bearer ${token}`);
  let input;
  if (body !== undefined) {
    args.push("-H", "Content-Type: application/json", "--data-binary", "@-");
    input = JSON.stringify(body);
  }
  const meta = execFileSync("curl.exe", args, { input, encoding: "utf8" });
  const [status, contentType] = meta.split("|");
  const bruto = fs.readFileSync(TMP);

  let respuesta;
  if (contentType.includes("application/json")) respuesta = JSON.parse(bruto.toString("utf8"));
  else if (contentType.includes("application/pdf")) respuesta = { pdf_bytes: bruto.length, inicio: bruto.subarray(0, 5).toString() };
  else respuesta = bruto.toString("utf8");

  paso += 1;
  const archivo = `${String(paso).padStart(3, "0")}-${nombre}.json`;
  // El JWT no se guarda: cambia en cada corrida y no aporta a la comparación.
  const guardado = respuesta && respuesta.token ? { ...respuesta, token: "<jwt>" } : respuesta;
  fs.writeFileSync(
    path.join(DESTINO, archivo),
    JSON.stringify({ metodo, ruta, status: Number(status), content_type: contentType, body: guardado }, null, 2)
  );
  console.log(`${status} ${metodo} ${ruta}`);
  return { status: Number(status), body: respuesta };
}

function esperar(condicion, mensaje) {
  if (!condicion) {
    console.error(`FALLÓ: ${mensaje}`);
    process.exitCode = 1;
  }
}

// US-01 Login y sesión
curl("login-sin-datos", "POST", "/api/auth/login", { body: {} });
curl("login-clave-mala", "POST", "/api/auth/login", { body: { usuario_login: ADMIN_LOGIN, password: "no-es-esta" } });
const loginAdmin = curl("login-admin", "POST", "/api/auth/login", { body: { usuario_login: ADMIN_LOGIN, password: ADMIN_PASSWORD } });
esperar(loginAdmin.status === 200, "login admin");
const admin = loginAdmin.body.token;
curl("me", "GET", "/api/auth/me", { token: admin });
curl("sin-token", "GET", "/api/pedidos");
curl("token-invalido", "GET", "/api/pedidos", { token: "x.y.z" });

// US-02 Usuarios y roles
curl("crear-mesero", "POST", "/api/usuarios", {
  token: admin,
  body: { nombre: "Mesero Escenario", usuario_login: "esc_mesero", password: CLAVE_ESCENARIO, rol: "mesero" },
});
curl("crear-cajero", "POST", "/api/usuarios", {
  token: admin,
  body: { nombre: "Cajero Escenario", usuario_login: "esc_cajero", password: CLAVE_ESCENARIO, rol: "cajero" },
});
curl("crear-usuario-duplicado", "POST", "/api/usuarios", {
  token: admin,
  body: { nombre: "Otro", usuario_login: "esc_mesero", password: CLAVE_ESCENARIO, rol: "mesero" },
});
curl("crear-usuario-rol-malo", "POST", "/api/usuarios", {
  token: admin,
  body: { nombre: "Otro", usuario_login: "otro", password: CLAVE_ESCENARIO, rol: "jefe" },
});
curl("listar-usuarios", "GET", "/api/usuarios", { token: admin });
const mesero = curl("login-mesero", "POST", "/api/auth/login", { body: { usuario_login: "esc_mesero", password: CLAVE_ESCENARIO } }).body.token;
const cajero = curl("login-cajero", "POST", "/api/auth/login", { body: { usuario_login: "esc_cajero", password: CLAVE_ESCENARIO } }).body.token;
curl("mesero-productos-403", "GET", "/api/productos", { token: mesero });
curl("cajero-crear-mesa-403", "POST", "/api/mesas", { token: cajero, body: { numero: 5 } });
curl("cajero-usuarios-403", "GET", "/api/usuarios", { token: cajero });

// US-04 Productos y categorías
curl("listar-categorias", "GET", "/api/categorias", { token: admin });
curl("crear-categoria", "POST", "/api/categorias", { token: cajero, body: { nombre: "Snacks" } });
curl("crear-categoria-duplicada", "POST", "/api/categorias", { token: admin, body: { nombre: "Snacks" } });
const idLicor = curl("listar-categorias-2", "GET", "/api/categorias", { token: admin }).body.find((c) => c.nombre === "Licor").id_categoria;
curl("crear-producto-incompleto", "POST", "/api/productos", { token: admin, body: { nombre: "X" } });
curl("crear-producto-precio-0", "POST", "/api/productos", {
  token: admin,
  body: { nombre: "X", id_categoria: idLicor, unidad_medida: "botella", precio: 0 },
});
curl("crear-producto-categoria-mala", "POST", "/api/productos", {
  token: admin,
  body: { nombre: "X", id_categoria: 999, unidad_medida: "botella", precio: 10 },
});
curl("crear-producto-tasa-mala", "POST", "/api/productos", {
  token: admin,
  body: { nombre: "X", id_categoria: idLicor, unidad_medida: "botella", precio: 10, tasa_iva_bps: 20000 },
});
const ron = curl("crear-producto-ron", "POST", "/api/productos", {
  token: admin,
  body: {
    nombre: "Escenario Ron",
    id_categoria: idLicor,
    unidad_medida: "botella",
    precio: 45000,
    stock_actual: 20,
    umbral_alerta: 5,
    tasa_iva_bps: 1900,
    tasa_inc_bps: 800,
    es_bebida_alcoholica: true,
  },
}).body;
const hielo = curl("crear-producto-hielo", "POST", "/api/productos", {
  token: cajero,
  body: { nombre: "Escenario Hielo", id_categoria: idLicor, unidad_medida: "bolsa", precio: 3500.5, stock_actual: 4, umbral_alerta: 3 },
}).body;
curl("editar-producto-hielo", "PUT", `/api/productos/${hielo.id_producto}`, {
  token: admin,
  body: { nombre: "Escenario Hielo", id_categoria: idLicor, unidad_medida: "bolsa", precio: 3500, umbral_alerta: 5, tasa_inc_bps: 800 },
});
curl("editar-producto-inexistente", "PUT", "/api/productos/999", {
  token: admin,
  body: { nombre: "X", id_categoria: idLicor, unidad_medida: "bolsa", precio: 1 },
});
curl("obtener-producto", "GET", `/api/productos/${ron.id_producto}`, { token: admin });
curl("obtener-producto-inexistente", "GET", "/api/productos/999", { token: admin });
curl("obtener-producto-id-no-numerico", "GET", "/api/productos/abc", { token: admin });
curl("listar-productos", "GET", "/api/productos", { token: admin });

// US-05 Proveedores
curl("crear-proveedor-sin-nombre", "POST", "/api/proveedores", { token: admin, body: {} });
const prov = curl("crear-proveedor", "POST", "/api/proveedores", {
  token: admin,
  body: { nombre: "Escenario Distribuidora", contacto: "300 000 0000" },
}).body;
curl("crear-proveedor-sin-contacto", "POST", "/api/proveedores", { token: cajero, body: { nombre: "Escenario Sin Contacto" } });
curl("asociar-ron", "POST", `/api/proveedores/${prov.id_proveedor}/productos`, { token: admin, body: { id_producto: ron.id_producto } });
curl("asociar-hielo", "POST", `/api/proveedores/${prov.id_proveedor}/productos`, { token: admin, body: { id_producto: hielo.id_producto } });
curl("asociar-repetido", "POST", `/api/proveedores/${prov.id_proveedor}/productos`, { token: admin, body: { id_producto: ron.id_producto } });
curl("asociar-producto-inexistente", "POST", `/api/proveedores/${prov.id_proveedor}/productos`, { token: admin, body: { id_producto: 999 } });
curl("obtener-proveedor", "GET", `/api/proveedores/${prov.id_proveedor}`, { token: admin });
curl("obtener-proveedor-inexistente", "GET", "/api/proveedores/999", { token: admin });
curl("listar-proveedores", "GET", "/api/proveedores", { token: admin });

// US-06 Entradas
curl("entrada-sin-proveedor", "POST", "/api/inventario/entradas", { token: admin, body: { id_producto: ron.id_producto, cantidad: 5 } });
curl("entrada-proveedor-inexistente", "POST", "/api/inventario/entradas", {
  token: admin,
  body: { id_producto: ron.id_producto, cantidad: 5, id_proveedor: 999 },
});
curl("entrada-ron", "POST", "/api/inventario/entradas", {
  token: cajero,
  body: { id_producto: ron.id_producto, cantidad: 10, id_proveedor: prov.id_proveedor },
});

// US-07 Salidas
curl("salida-motivo-malo", "POST", "/api/inventario/salidas", { token: admin, body: { id_producto: ron.id_producto, cantidad: 1, motivo: "robo" } });
curl("salida-sin-stock", "POST", "/api/inventario/salidas", { token: admin, body: { id_producto: hielo.id_producto, cantidad: 999, motivo: "ajuste" } });
curl("salida-ajuste", "POST", "/api/inventario/salidas", { token: admin, body: { id_producto: ron.id_producto, cantidad: 2, motivo: "ajuste" } });
curl("salida-cantidad-0", "POST", "/api/inventario/salidas", { token: admin, body: { id_producto: ron.id_producto, cantidad: 0, motivo: "ajuste" } });

// US-08 Alertas de stock bajo
curl("productos-bajo-stock", "GET", "/api/productos?bajo_stock=true", { token: admin });

// US-09 / US-18 Historial de movimientos
curl("movimientos", "GET", "/api/inventario/movimientos", { token: admin });
curl("movimientos-por-producto", "GET", `/api/inventario/movimientos?id_producto=${ron.id_producto}`, { token: admin });
curl("movimientos-rango", "GET", `/api/inventario/movimientos?desde=2000-01-01&hasta=${HOY}`, { token: admin });
curl("movimientos-rango-futuro", "GET", "/api/inventario/movimientos?desde=2100-01-01", { token: admin });
curl("movimientos-fecha-invalida", "GET", "/api/inventario/movimientos?desde=ayer", { token: admin });
curl("movimientos-por-usuario", "GET", "/api/inventario/movimientos?id_usuario=3", { token: admin });

// US-10 Mesas y QR
curl("crear-mesa-sin-numero", "POST", "/api/mesas", { token: admin, body: {} });
const mesa = curl("crear-mesa", "POST", "/api/mesas", { token: admin, body: { numero: 7 } }).body;
curl("crear-mesa-duplicada", "POST", "/api/mesas", { token: admin, body: { numero: 7 } });
const mesa2 = curl("crear-mesa-2", "POST", "/api/mesas", { token: admin, body: { numero: 3 } }).body;
curl("listar-mesas-mesero", "GET", "/api/mesas", { token: mesero });
curl("obtener-mesa", "GET", `/api/mesas/${mesa.id_mesa}`, { token: mesero });
curl("obtener-mesa-inexistente", "GET", "/api/mesas/999", { token: admin });
curl("obtener-mesa-id-no-numerico", "GET", "/api/mesas/abc", { token: admin });
curl("qr-mesa", "GET", `/api/mesas/${mesa.id_mesa}/qr`, { token: cajero });
curl("qr-mesa-mesero-403", "GET", `/api/mesas/${mesa.id_mesa}/qr`, { token: mesero });

// US-11 Catálogo público
curl("catalogo", "GET", `/api/catalogo/${mesa.codigo_qr_token}`);
curl("catalogo-token-malo", "GET", "/api/catalogo/no-existe");

// US-12 Autopedido
curl("pedido-vacio", "POST", `/api/catalogo/${mesa.codigo_qr_token}/pedidos`, { body: { items: [] } });
curl("pedido-cantidad-mala", "POST", `/api/catalogo/${mesa.codigo_qr_token}/pedidos`, {
  body: { items: [{ id_producto: ron.id_producto, cantidad: 1.5 }] },
});
curl("pedido-sin-stock", "POST", `/api/catalogo/${mesa.codigo_qr_token}/pedidos`, {
  body: { items: [{ id_producto: hielo.id_producto, cantidad: 99 }] },
});
curl("pedido-producto-inexistente", "POST", `/api/catalogo/${mesa.codigo_qr_token}/pedidos`, {
  body: { items: [{ id_producto: 999, cantidad: 1 }] },
});
const pedido1 = curl("pedido-1", "POST", `/api/catalogo/${mesa.codigo_qr_token}/pedidos`, {
  body: { items: [{ id_producto: ron.id_producto, cantidad: 1 }, { id_producto: hielo.id_producto, cantidad: 2 }] },
}).body;
curl("pedido-2", "POST", `/api/catalogo/${mesa.codigo_qr_token}/pedidos`, {
  body: { items: [{ id_producto: ron.id_producto, cantidad: "2" }] },
});
const pedidoACancelar = curl("pedido-mesa-2", "POST", `/api/catalogo/${mesa2.codigo_qr_token}/pedidos`, {
  body: { items: [{ id_producto: hielo.id_producto, cantidad: 1 }] },
}).body;
curl("catalogo-pedidos-mesa", "GET", `/api/catalogo/${mesa.codigo_qr_token}/pedidos`);

// US-13 / US-14b Panel de pedidos (polling)
curl("pedidos-mesero", "GET", "/api/pedidos", { token: mesero });
curl("pedidos-por-mesa", "GET", `/api/pedidos?id_mesa=${mesa.id_mesa}`, { token: mesero });
curl("pedidos-por-estado", "GET", "/api/pedidos?estado=pendiente", { token: admin });
curl("entregar-pedido", "PUT", `/api/pedidos/${pedido1.id_pedido}/entregado`, { token: mesero });
curl("entregar-pedido-inexistente", "PUT", "/api/pedidos/999/entregado", { token: mesero });
curl("cancelar-pedido-mesero-403", "DELETE", `/api/pedidos/${pedidoACancelar.id_pedido}`, { token: mesero });
curl("cancelar-pedido", "DELETE", `/api/pedidos/${pedidoACancelar.id_pedido}`, { token: cajero });
curl("cancelar-pedido-inexistente", "DELETE", `/api/pedidos/${pedidoACancelar.id_pedido}`, { token: cajero });
curl("mesas-tras-pedidos", "GET", "/api/mesas", { token: admin });

// US-14 Cierre de cuenta (con factura)
curl("cerrar-mesa-mesero-403", "POST", `/api/mesas/${mesa.id_mesa}/cerrar-cuenta`, { token: mesero });
curl("cerrar-mesa-forma-pago-mala", "POST", `/api/mesas/${mesa.id_mesa}/cerrar-cuenta`, { token: cajero, body: { forma_pago: "bitcoin" } });
curl("cerrar-mesa-cliente-incompleto", "POST", `/api/mesas/${mesa.id_mesa}/cerrar-cuenta`, {
  token: cajero,
  body: { cliente: { tipo_doc: "CC" } },
});
const cierre = curl("cerrar-mesa", "POST", `/api/mesas/${mesa.id_mesa}/cerrar-cuenta`, {
  token: cajero,
  body: { forma_pago: "tarjeta_debito", cliente: { nombre: "Cliente Escenario", tipo_doc: "NIT", num_doc: "900123456", dv: "8" } },
}).body;
curl("cerrar-mesa-libre", "POST", `/api/mesas/${mesa.id_mesa}/cerrar-cuenta`, { token: cajero });
curl("cerrar-mesa-inexistente", "POST", "/api/mesas/999/cerrar-cuenta", { token: cajero });
// Mesa 2 quedó ocupada sin pedidos (se canceló el único): cierre sin pedidos.
curl("cerrar-mesa-sin-pedidos", "POST", `/api/mesas/${mesa2.id_mesa}/cerrar-cuenta`, { token: cajero });
curl("catalogo-pedidos-tras-cierre", "GET", `/api/catalogo/${mesa.codigo_qr_token}/pedidos`);

// US-15 / US-16 Venta de mostrador y descuento de inventario
curl("venta-vacia", "POST", "/api/ventas", { token: cajero, body: { items: [] } });
curl("venta-sin-stock", "POST", "/api/ventas", {
  token: cajero,
  body: { items: [{ id_producto: ron.id_producto, cantidad: 1 }, { id_producto: hielo.id_producto, cantidad: 999 }] },
});
curl("stock-tras-venta-fallida", "GET", `/api/productos/${ron.id_producto}`, { token: admin });
curl("venta-producto-inexistente", "POST", "/api/ventas", { token: cajero, body: { items: [{ id_producto: 999, cantidad: 1 }] } });
const ventaMostrador = curl("venta-mostrador", "POST", "/api/ventas", {
  token: cajero,
  body: { items: [{ id_producto: ron.id_producto, cantidad: 2 }, { id_producto: hielo.id_producto, cantidad: 1 }], forma_pago: "transferencia" },
}).body;
curl("venta-mostrador-mesero-403", "POST", "/api/ventas", { token: mesero, body: { items: [{ id_producto: ron.id_producto, cantidad: 1 }] } });
curl("productos-tras-ventas", "GET", "/api/productos", { token: admin });

// US-17 Reporte de ventas
curl("ventas", "GET", "/api/ventas", { token: admin });
curl("ventas-mesa", "GET", "/api/ventas?tipo=mesa", { token: admin });
curl("ventas-mostrador", "GET", "/api/ventas?tipo=mostrador", { token: admin });
curl("ventas-rango", "GET", `/api/ventas?desde=${HOY}&hasta=${HOY}`, { token: admin });
curl("ventas-rango-pasado", "GET", "/api/ventas?hasta=2000-01-01", { token: admin });

// Facturación: consulta, PDF, anulación y emisor
curl("facturas", "GET", "/api/facturas", { token: cajero });
curl("facturas-rango", "GET", `/api/facturas?desde=${HOY}`, { token: cajero });
curl("factura-mesa", "GET", `/api/facturas/${cierre.factura.id_factura}`, { token: cajero });
curl("factura-inexistente", "GET", "/api/facturas/999", { token: cajero });
curl("factura-pdf", "GET", `/api/facturas/${cierre.factura.id_factura}/pdf`, { token: cajero });
curl("factura-pdf-inexistente", "GET", "/api/facturas/999/pdf", { token: cajero });
curl("anular-cajero-403", "POST", `/api/facturas/${cierre.factura.id_factura}/anular`, { token: cajero, body: { motivo: "Motivo suficientemente largo" } });
curl("anular-motivo-corto", "POST", `/api/facturas/${cierre.factura.id_factura}/anular`, { token: admin, body: { motivo: "corto" } });
curl("anular-reabrir-mostrador", "POST", `/api/facturas/${ventaMostrador.factura.id_factura}/anular`, {
  token: admin,
  body: { motivo: "Prueba de anulación de mostrador", reabrir_pedidos: true },
});
curl("anular-mostrador", "POST", `/api/facturas/${ventaMostrador.factura.id_factura}/anular`, {
  token: admin,
  body: { motivo: "Prueba de anulación de mostrador" },
});
curl("anular-otra-vez", "POST", `/api/facturas/${ventaMostrador.factura.id_factura}/anular`, {
  token: admin,
  body: { motivo: "Prueba de anulación de mostrador" },
});
curl("anular-mesa-reabriendo", "POST", `/api/facturas/${cierre.factura.id_factura}/anular`, {
  token: admin,
  body: { motivo: "Cobro con forma de pago equivocada", reabrir_pedidos: true },
});
curl("pedidos-reabiertos", "GET", `/api/pedidos?id_mesa=${mesa.id_mesa}`, { token: admin });
curl("mesas-tras-anular", "GET", "/api/mesas", { token: admin });
curl("recobrar-mesa", "POST", `/api/mesas/${mesa.id_mesa}/cerrar-cuenta`, { token: admin, body: { forma_pago: "efectivo" } });
curl("ventas-con-anuladas", "GET", "/api/ventas?incluir_anuladas=true", { token: admin });
curl("ventas-sin-anuladas", "GET", "/api/ventas", { token: admin });
curl("productos-tras-anular", "GET", "/api/productos", { token: admin });
curl("emisor", "GET", "/api/emisor", { token: cajero });
curl("emisor-cajero-403", "PUT", "/api/emisor", { token: cajero, body: { razon_social: "X" } });
curl("emisor-dv-malo", "PUT", "/api/emisor", { token: admin, body: { nit: "900123456", dv: "1" } });
curl("emisor-titulo-malo", "PUT", "/api/emisor", { token: admin, body: { titulo_documento: "Factura" } });
curl("emisor-editar", "PUT", "/api/emisor", {
  token: admin,
  body: { razon_social: "Licorera Escenario", nit: "900.123.456", telefono: "", titulo_documento: "FACTURA DE VENTA" },
});

// US-18 / US-19 Reportes y exportación
curl("movimientos-final", "GET", "/api/inventario/movimientos", { token: admin });
curl("movimientos-csv", "GET", "/api/inventario/movimientos?formato=csv", { token: admin });
curl("ventas-csv", "GET", "/api/ventas?formato=csv&incluir_anuladas=true", { token: admin });

// US-03 Bitácora de auditoría
curl("auditoria", "GET", "/api/auditoria", { token: admin });
curl("auditoria-por-entidad", "GET", "/api/auditoria?entidad=ventas", { token: admin });
curl("auditoria-cajero-403", "GET", "/api/auditoria", { token: cajero });

curl("ruta-inexistente", "GET", "/api/no-existe");
curl("salud", "GET", "/api/salud");

fs.rmSync(TMP, { force: true });
console.log(`\n${paso} respuestas guardadas en ${DESTINO}`);
