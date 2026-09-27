// Manejador central de errores: código y mensaje por tipo de error, formato
// { error } y mensajes genéricos en los 500 (siempre en el catálogo público).
// App Express mínima: sin base de datos.
const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const errores = require("../src/utils/errores");
const { manejoErrores, rutaNoEncontrada, MENSAJE_500, MENSAJE_500_PUBLICO } = require("../src/middlewares/manejoErrores");

const app = express();
app.use(express.json());
const lanzar = (crear) => async () => {
  throw crear();
};
for (const prefijo of ["/api/interna", "/api/catalogo"]) {
  app.get(`${prefijo}/conflicto`, lanzar(() => new errores.ErrorConflicto("La factura ya está anulada.")));
  app.get(`${prefijo}/validacion`, lanzar(() => new errores.ErrorValidacion("Solo quedan 2 unidades de Ron.")));
  app.get(`${prefijo}/interno`, lanzar(() => new errores.ErrorInterno("No hay una secuencia de facturación activa.")));
  app.get(`${prefijo}/pg`, lanzar(() => Object.assign(new Error('relation "facturas" does not exist'), { code: "42P01" })));
  app.get(`${prefijo}/limite`, lanzar(() => new errores.ErrorDemasiadosIntentos("Demasiados intentos.", 42)));
  app.post(`${prefijo}/json`, (req, res) => res.json(req.body));
}
app.get("/api/interna/legado", lanzar(() => Object.assign(new Error("Mesa no encontrada."), { status: 404 })));
app.get("/api/interna/http-errors", lanzar(() => Object.assign(new Error("Forbidden"), { status: 403, expose: true })));
app.get("/api/interna/sincrono", () => {
  throw new TypeError("Cannot read properties of undefined (reading 'x')");
});
app.use(rutaNoEncontrada);
app.use(manejoErrores);

let base;
let servidor;
test.before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

async function pedir(ruta, opciones) {
  const res = await fetch(base + ruta, opciones);
  return { status: res.status, tipo: res.headers.get("content-type"), headers: res.headers, texto: await res.text() };
}
const cuerpo = (r) => JSON.parse(r.texto);

test("cada ErrorApp conserva su código y su mensaje, en formato { error }", async () => {
  for (const [ruta, status, mensaje] of [
    ["/api/interna/conflicto", 409, "La factura ya está anulada."],
    ["/api/interna/validacion", 400, "Solo quedan 2 unidades de Ron."],
    ["/api/interna/interno", 500, "No hay una secuencia de facturación activa."],
  ]) {
    const r = await pedir(ruta);
    assert.strictEqual(r.status, status, ruta);
    assert.match(r.tipo, /application\/json/);
    assert.deepStrictEqual(cuerpo(r), { error: mensaje });
  }
});

test("error inesperado (pg, bug) → 500 genérico, sin el texto de la excepción ni stack", async () => {
  for (const ruta of ["/api/interna/pg", "/api/interna/sincrono"]) {
    const r = await pedir(ruta);
    assert.strictEqual(r.status, 500);
    assert.deepStrictEqual(cuerpo(r), { error: MENSAJE_500 });
    assert.ok(!/facturas|undefined|at |\.js/.test(r.texto), r.texto);
  }
});

test("catálogo público: 4xx de negocio igual que el panel; todo 500 con mensaje genérico", async () => {
  assert.deepStrictEqual(cuerpo(await pedir("/api/catalogo/conflicto")), { error: "La factura ya está anulada." });
  assert.deepStrictEqual(cuerpo(await pedir("/api/catalogo/validacion")), { error: "Solo quedan 2 unidades de Ron." });
  for (const ruta of ["/api/catalogo/interno", "/api/catalogo/pg"]) {
    const r = await pedir(ruta);
    assert.strictEqual(r.status, 500);
    assert.deepStrictEqual(cuerpo(r), { error: MENSAJE_500_PUBLICO });
  }
});

test("JSON mal formado → 400 en JSON con mensaje en español (antes: HTML con stack)", async () => {
  for (const prefijo of ["/api/interna", "/api/catalogo"]) {
    const r = await pedir(`${prefijo}/json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{mal" });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(cuerpo(r), { error: "El cuerpo de la petición no es un JSON válido." });
  }
});

test("429 lleva Retry-After; ruta inexistente → 404 'Ruta no encontrada.'", async () => {
  const r = await pedir("/api/catalogo/limite");
  assert.strictEqual(r.status, 429);
  assert.strictEqual(r.headers.get("retry-after"), "42");
  const n = await pedir("/api/no-existe");
  assert.strictEqual(n.status, 404);
  assert.deepStrictEqual(cuerpo(n), { error: "Ruta no encontrada." });
});

test("un Error suelto con status numérico ya no decide la respuesta: solo ErrorApp lo hace → 500", async () => {
  const r = await pedir("/api/interna/legado");
  assert.strictEqual(r.status, 500);
  assert.deepStrictEqual(cuerpo(r), { error: MENSAJE_500 });
});

test("4xx de librerías (http-errors con expose) conservan su código, con mensaje en español", async () => {
  const r = await pedir("/api/interna/http-errors");
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(cuerpo(r), { error: "La petición no es válida." });
});
