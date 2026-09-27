// Permiso sobre los impuestos de un producto (tasas IVA/INC y bebida
// alcohólica): solo el administrador puede cambiarlos. Se prueba por HTTP con
// la app real (auth, requireRole, controlador y servicio) y el modelo de
// productos en memoria: no se toca ninguna base de datos.
//
// DATABASE_URL apunta a un puerto local cerrado ANTES de cargar la app: dotenv
// no sobrescribe variables ya definidas, así que el .env (Supabase) nunca se usa.
process.env.DATABASE_URL = "postgresql://prueba:prueba@127.0.0.1:1/sin_base";
process.env.JWT_SECRET = "secreto-solo-para-pruebas";

const test = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");
const productoModel = require("../src/models/productoModel");
const logAuditoriaModel = require("../src/models/logAuditoriaModel");

// ---------- Modelo en memoria ----------
let productos;
let escrituras;
function reiniciar() {
  escrituras = 0;
  productos = new Map([
    [1, {
      id_producto: 1, id_categoria: 1, categoria_nombre: "Licor", nombre: "Ron", unidad_medida: "botella",
      precio: 45000, stock_actual: 10, umbral_alerta: 2, tasa_iva_bps: 1900, tasa_inc_bps: 800,
      es_bebida_alcoholica: 1, costo: null, codigo_barras: null, marca: null, volumen_ml: null,
      grado_alcohol: null, descripcion: null, activo: 1,
    }],
  ]);
}
productoModel.buscarPorId = async (id) => (productos.has(id) ? { ...productos.get(id) } : undefined);
productoModel.existeCategoria = async () => true;
productoModel.codigoEnUso = async () => false;
productoModel.crear = async (datos) => {
  escrituras += 1;
  const id = productos.size + 1;
  productos.set(id, { id_producto: id, categoria_nombre: "Licor", ...datos });
  return { ...productos.get(id) };
};
productoModel.editar = async (id, datos) => {
  escrituras += 1;
  productos.set(id, { ...productos.get(id), ...datos });
  return { ...productos.get(id) };
};
logAuditoriaModel.registrar = async () => {};

const app = require("../src/app");

const token = (rol) => jwt.sign({ id_usuario: 1, usuario_login: rol, rol }, process.env.JWT_SECRET);
const ADMIN = token("administrador");
const CAJERO = token("cajero");
const MENSAJE_403 = "Solo el administrador puede modificar los impuestos de un producto.";

let servidor;
let base;
test.before(() => new Promise((listo) => {
  servidor = app.listen(0, () => {
    base = `http://127.0.0.1:${servidor.address().port}`;
    listo();
  });
}));
test.after(() => new Promise((listo) => servidor.close(listo)));
test.beforeEach(reiniciar);

async function pedir(metodo, ruta, tokenRol, body) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${tokenRol}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// Cuerpo completo, como lo envía el formulario del panel al editar el Ron.
const edicionRon = (cambios = {}) => ({
  nombre: "Ron", id_categoria: 1, unidad_medida: "botella", precio: 45000, umbral_alerta: 2,
  tasa_iva_bps: 1900, tasa_inc_bps: 800, es_bebida_alcoholica: true, ...cambios,
});
const nuevo = (cambios = {}) => ({
  nombre: "Hielo", id_categoria: 1, unidad_medida: "bolsa", precio: 3500, stock_actual: 5, ...cambios,
});

test("cajero edita el precio con los impuestos iguales → 200", async () => {
  const r = await pedir("PUT", "/api/productos/1", CAJERO, edicionRon({ precio: 48000 }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.precio, 48000);
  assert.strictEqual(r.json.tasa_iva_bps, 1900);
  assert.strictEqual(r.json.tasa_inc_bps, 800);
  assert.strictEqual(r.json.es_bebida_alcoholica, 1);
});

test("cajero edita sin enviar los impuestos → 200 y se conservan", async () => {
  const { tasa_iva_bps, tasa_inc_bps, es_bebida_alcoholica, ...sinImpuestos } = edicionRon({ precio: 47000 });
  const r = await pedir("PUT", "/api/productos/1", CAJERO, sinImpuestos);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.tasa_inc_bps, 800);
});

test("cajero cambia el IVA → 403 y no se guarda nada", async () => {
  const r = await pedir("PUT", "/api/productos/1", CAJERO, edicionRon({ tasa_iva_bps: 0, precio: 1 }));
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.error, MENSAJE_403);
  assert.strictEqual(escrituras, 0);
  assert.strictEqual(productos.get(1).tasa_iva_bps, 1900);
  assert.strictEqual(productos.get(1).precio, 45000);
});

test("cajero cambia el INC o la bebida alcohólica → 403", async () => {
  for (const cambio of [{ tasa_inc_bps: 0 }, { es_bebida_alcoholica: false }, { tasa_iva_bps: "500" }]) {
    const r = await pedir("PUT", "/api/productos/1", CAJERO, edicionRon(cambio));
    assert.strictEqual(r.status, 403, JSON.stringify(cambio));
  }
  assert.strictEqual(escrituras, 0);
});

test("cajero crea con los impuestos por defecto (enviados o no) → 201", async () => {
  const conDefecto = await pedir("POST", "/api/productos", CAJERO, nuevo({ tasa_iva_bps: 1900, tasa_inc_bps: 0, es_bebida_alcoholica: false }));
  assert.strictEqual(conDefecto.status, 201);
  assert.strictEqual(conDefecto.json.tasa_iva_bps, 1900);
  assert.strictEqual(conDefecto.json.tasa_inc_bps, 0);
  assert.strictEqual(conDefecto.json.es_bebida_alcoholica, 0);

  const sinImpuestos = await pedir("POST", "/api/productos", CAJERO, nuevo());
  assert.strictEqual(sinImpuestos.status, 201);
  assert.strictEqual(sinImpuestos.json.tasa_iva_bps, 1900);
});

test("cajero crea con impuestos distintos a los de por defecto → 403 y no se crea", async () => {
  for (const cambio of [{ tasa_iva_bps: 0 }, { tasa_inc_bps: 800 }, { es_bebida_alcoholica: true }]) {
    const r = await pedir("POST", "/api/productos", CAJERO, nuevo(cambio));
    assert.strictEqual(r.status, 403, JSON.stringify(cambio));
    assert.strictEqual(r.json.error, MENSAJE_403);
  }
  assert.strictEqual(escrituras, 0);
});

test("administrador cambia los impuestos al editar y al crear → 200 / 201", async () => {
  const edicion = await pedir("PUT", "/api/productos/1", ADMIN, edicionRon({ tasa_iva_bps: 500, tasa_inc_bps: 0, es_bebida_alcoholica: false }));
  assert.strictEqual(edicion.status, 200);
  assert.strictEqual(edicion.json.tasa_iva_bps, 500);
  assert.strictEqual(edicion.json.tasa_inc_bps, 0);
  assert.strictEqual(edicion.json.es_bebida_alcoholica, 0);

  const creado = await pedir("POST", "/api/productos", ADMIN, nuevo({ tasa_iva_bps: 0, tasa_inc_bps: 800, es_bebida_alcoholica: true }));
  assert.strictEqual(creado.status, 201);
  assert.strictEqual(creado.json.tasa_inc_bps, 800);
});
