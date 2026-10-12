// GET /api/alertas-stock[?ventana_dias&cobertura_alerta_dias&dias_objetivo]
//
// 1) Parámetros, ventana y resumen: sin base de datos (el modelo se reemplaza), siempre corren.
// 2) Integración por HTTP con la app real y datos de prueba: solo con un Postgres
//    LOCAL desechable y recién creado (sin productos), igual que test/reportes.test.js:
//      PRUEBA_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres node --test test/alertasStock.test.js
//    Sin esa variable, o si apunta fuera de localhost o la base ya tiene productos,
//    se salta (nunca borra nada y nunca corre contra Supabase). Como reportes.test.js
//    también necesita la base vacía, cada archivo de integración va con su propia base.
const URL_PRUEBA = process.env.PRUEBA_DATABASE_URL || "";
let hostPrueba = "";
try {
  hostPrueba = new URL(URL_PRUEBA).hostname;
} catch {
  // sin base de prueba
}
const BASE_LOCAL = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostPrueba) && !/supabase/i.test(URL_PRUEBA);
if (BASE_LOCAL) {
  process.env.DATABASE_URL = URL_PRUEBA;
  process.env.PGSSLMODE = "disable";
} else {
  process.env.DATABASE_URL = "postgresql://prueba:prueba@127.0.0.1:1/sin_base";
}
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";

const test = require("node:test");
const assert = require("node:assert");
const alertaStockModel = require("../src/models/alertaStockModel");
const alertaStockService = require("../src/services/alertaStockService");
const { ErrorValidacion } = require("../src/utils/errores");
const { hoyColombia } = require("../src/utils/fechaColombia");

// ---------- 1) Parámetros, ventana y resumen ----------

test("servicio: valores por defecto, ventana de días de Colombia y resumen por estado", async (t) => {
  const original = alertaStockModel.listar;
  t.after(() => {
    alertaStockModel.listar = original;
  });
  let recibido;
  alertaStockModel.listar = async (p) => {
    recibido = p;
    return [{ estado: "agotado" }, { estado: "bajo_minimo" }, { estado: "por_agotarse" }, { estado: "por_agotarse" }];
  };

  const r = await alertaStockService.listar({}, "2026-10-11");
  assert.deepStrictEqual(recibido, {
    ventana_dias: 30, cobertura_alerta_dias: 5, dias_objetivo: 14, desde: "2026-09-12", hasta: "2026-10-11",
  });
  assert.deepStrictEqual(r.parametros, {
    ventana_dias: 30, cobertura_alerta_dias: 5, dias_objetivo: 14,
    desde: "2026-09-12", hasta: "2026-10-11", zona_horaria: "America/Bogota",
  });
  assert.deepStrictEqual(r.resumen, { total: 4, agotado: 1, bajo_minimo: 1, por_agotarse: 2 });

  // Ventana de 1 día = solo hoy; cruza el año; vacíos toman el valor por defecto.
  await alertaStockService.listar({ ventana_dias: "1", cobertura_alerta_dias: "", dias_objetivo: " 7 " }, "2026-01-01");
  assert.deepStrictEqual(recibido, {
    ventana_dias: 1, cobertura_alerta_dias: 5, dias_objetivo: 7, desde: "2026-01-01", hasta: "2026-01-01",
  });
  await alertaStockService.listar({ ventana_dias: "365" }, "2028-03-01");
  assert.strictEqual(recibido.desde, "2027-03-03"); // 2028 es bisiesto
});

test("servicio: parámetros inválidos → 400 antes de consultar la base", async () => {
  for (const [nombre, valor] of [
    ["ventana_dias", "0"], ["ventana_dias", "366"], ["ventana_dias", "abc"], ["ventana_dias", "1.5"],
    ["cobertura_alerta_dias", "-3"], ["cobertura_alerta_dias", "5d"], ["dias_objetivo", "1e2"], ["dias_objetivo", "0"],
  ]) {
    await assert.rejects(alertaStockService.listar({ [nombre]: valor }, "2026-10-11"), (err) => {
      assert.ok(err instanceof ErrorValidacion);
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.message, `${nombre} debe ser un número entero entre 1 y 365.`);
      return true;
    });
  }
});

// ---------- 2) Integración con datos de prueba ----------

// "AAAA-MM-DD" de hace n días en Colombia, al mediodía de Colombia (17:00 UTC).
function haceDias(n) {
  const d = new Date(`${hoyColombia()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return `${d.toISOString().slice(0, 10)} 17:00:00`;
}

test("integración: GET /api/alertas-stock con cada estado", { skip: !BASE_LOCAL && "sin PRUEBA_DATABASE_URL local" }, async (t) => {
  const db = require("../src/db/db");
  const bcrypt = require("bcryptjs");
  const app = require("../src/app");

  await db.inicializarEsquema();
  const { n } = await db.uno("SELECT COUNT(*) AS n FROM productos");
  if (n > 0) {
    await db.pool.end();
    t.skip("la base ya tiene productos: se necesita una base recién creada");
    return;
  }

  const clave = "Prueba123!";
  const password_hash = bcrypt.hashSync(clave, 4);
  const ids = {};
  for (const rol of ["administrador", "cajero", "mesero"]) {
    const u = await db.uno(
      `INSERT INTO usuarios (nombre, usuario_login, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id_usuario`,
      [`${rol} alertas`, `${rol}_alertas`, password_hash, rol]
    );
    ids[rol] = u.id_usuario;
  }
  const { id_categoria } = await db.uno("INSERT INTO categorias (nombre) VALUES ('Licores') RETURNING id_categoria");

  const producto = async (nombre, stock, umbral, activo = 1) =>
    (await db.uno(
      `INSERT INTO productos (id_categoria, nombre, unidad_medida, precio, stock_actual, umbral_alerta, activo)
       VALUES ($1, $2, 'botella', 10000, $3, $4, $5) RETURNING id_producto`,
      [id_categoria, nombre, stock, umbral, activo]
    )).id_producto;
  const venta = async (fecha_hora, id_producto, cantidad, estado = "activa") => {
    const { id_venta } = await db.uno(
      `INSERT INTO ventas (tipo, id_usuario, total, fecha_hora, estado) VALUES ('mostrador', $1, $2, $3, $4) RETURNING id_venta`,
      [ids.cajero, cantidad * 10000, fecha_hora, estado]
    );
    await db.ejecutar(
      "INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario) VALUES ($1, $2, $3, 10000)",
      [id_venta, id_producto, cantidad]
    );
  };

  // Ventana por defecto: 30 días de Colombia (hoy y los 29 anteriores), cobertura 5, objetivo 14.
  const P = {
    A: await producto("Aguardiente", 0, 5), // agotado, 30 vendidas → promedio 1
    B: await producto("Brandy", 0, 3), // agotado sin ventas → sugerida 3 × 2 − 0 = 6
    B2: await producto("Coñac", 0, 0), // agotado sin ventas y sin mínimo → sugerida 0
    C: await producto("Cerveza", 3, 5), // bajo mínimo, 60 vendidas → promedio 2, cobertura 1,5
    D: await producto("Dulce", 5, 5), // stock = mínimo: bajo mínimo, sin ventas → sugerida 5 × 2 − 5 = 5
    E: await producto("Exportación", 8, 2), // 60 vendidas (hoy) → cobertura 4: por agotarse
    F: await producto("Fino", 10, 2), // 60 vendidas → cobertura 5 exacta: ok (no es < 5)
    G: await producto("Ginebra", 50, 5), // sin ventas y sobre el mínimo: ok
    H: await producto("Hidromiel", 0, 5, 0), // inactivo: nunca aparece
    I: await producto("Isla", 8, 2), // 3 activas + 300 anuladas → cobertura 80: ok
    K: await producto("Kirsch", 4, 1), // 30 vendidas el primer día de la ventana; 1000 el día anterior no cuentan
    L: await producto("Licor de café", 3, 0), // 20 vendidas → promedio 0,67, cobertura 4,5
  };
  await venta(haceDias(10), P.A, 30);
  await venta(haceDias(1), P.C, 60);
  await venta(haceDias(0), P.E, 60);
  await venta(haceDias(2), P.F, 60);
  await venta(haceDias(3), P.I, 3);
  await venta(haceDias(3), P.I, 300, "anulada");
  await venta(haceDias(29), P.K, 30);
  await venta(haceDias(30), P.K, 1000);
  await venta(haceDias(5), P.L, 20);
  await venta(haceDias(4), P.H, 50);

  const servidor = app.listen(0);
  const base = `http://127.0.0.1:${servidor.address().port}/api`;
  t.after(async () => {
    servidor.close();
    await db.pool.end();
  });
  const login = async (rol) => {
    const r = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_login: `${rol}_alertas`, password: clave }),
    });
    return (await r.json()).token;
  };
  const tokens = { administrador: await login("administrador"), cajero: await login("cajero"), mesero: await login("mesero") };
  const pedir = async (query = "", token = tokens.cajero) => {
    const r = await fetch(`${base}/alertas-stock${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: r.status, body: await r.json() };
  };
  const filas = (lista) => lista.map((p) => [p.nombre, p.estado, p.unidades_vendidas, p.dias_cobertura, p.cantidad_sugerida]);

  await t.test("valores por defecto: cada estado, orden por urgencia y luego por lo más vendido", async () => {
    const { status, body } = await pedir();
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(filas(body.productos), [
      ["Aguardiente", "agotado", 30, 0, 14],
      ["Brandy", "agotado", 0, null, 6],
      ["Coñac", "agotado", 0, null, 0],
      ["Cerveza", "bajo_minimo", 60, 1.5, 25],
      ["Dulce", "bajo_minimo", 0, null, 5],
      ["Exportación", "por_agotarse", 60, 4, 20],
      ["Kirsch", "por_agotarse", 30, 4, 10],
      ["Licor de café", "por_agotarse", 20, 4.5, 7], // ceil(20 × 14 / 30 − 3) = ceil(6,33)
    ]);
    const cerveza = body.productos.find((p) => p.nombre === "Cerveza");
    assert.deepStrictEqual(cerveza, {
      id_producto: P.C, nombre: "Cerveza", categoria_nombre: "Licores", unidad_medida: "botella",
      stock_actual: 3, umbral_alerta: 5, estado: "bajo_minimo", unidades_vendidas: 60,
      promedio_diario: 2, dias_cobertura: 1.5, cantidad_sugerida: 25,
    });
    assert.strictEqual(body.productos.find((p) => p.nombre === "Licor de café").promedio_diario, 0.67);
    assert.deepStrictEqual(body.resumen, { total: 8, agotado: 3, bajo_minimo: 2, por_agotarse: 3 });
    const hoy = hoyColombia();
    assert.deepStrictEqual(body.parametros, {
      ventana_dias: 30, cobertura_alerta_dias: 5, dias_objetivo: 14,
      desde: haceDias(29).slice(0, 10), hasta: hoy, zona_horaria: "America/Bogota",
    });
  });

  await t.test("parámetros: cobertura 6 incluye el límite; objetivo 7; ventana de 1 día = solo hoy", async () => {
    const cob = await pedir("?cobertura_alerta_dias=6");
    assert.deepStrictEqual(
      cob.body.productos.filter((p) => p.estado === "por_agotarse").map((p) => p.nombre),
      ["Exportación", "Fino", "Kirsch", "Licor de café"]
    );
    assert.strictEqual(cob.body.parametros.cobertura_alerta_dias, 6);

    const obj = await pedir("?dias_objetivo=7");
    assert.strictEqual(obj.body.productos.find((p) => p.nombre === "Exportación").cantidad_sugerida, 6); // 60×7/30 − 8

    const dia = await pedir("?ventana_dias=1");
    assert.deepStrictEqual(filas(dia.body.productos), [
      ["Aguardiente", "agotado", 0, null, 10], // sin ventas en la ventana: 5 × 2 − 0
      ["Brandy", "agotado", 0, null, 6],
      ["Coñac", "agotado", 0, null, 0],
      ["Cerveza", "bajo_minimo", 0, null, 7], // 5 × 2 − 3
      ["Dulce", "bajo_minimo", 0, null, 5],
      ["Exportación", "por_agotarse", 60, 0.1, 832], // 60 × 14 − 8
    ]);
    assert.deepStrictEqual(dia.body.resumen, { total: 6, agotado: 3, bajo_minimo: 2, por_agotarse: 1 });
  });

  await t.test("validación (400) y roles (administrador y cajero sí; mesero 403; sin token 401)", async () => {
    assert.deepStrictEqual(await pedir("?ventana_dias=0"), {
      status: 400, body: { error: "ventana_dias debe ser un número entero entre 1 y 365." },
    });
    assert.strictEqual((await pedir("?dias_objetivo=abc")).status, 400);
    assert.strictEqual((await pedir("", tokens.administrador)).status, 200);
    assert.strictEqual((await pedir("", tokens.mesero)).status, 403);
    assert.strictEqual((await pedir("", null)).status, 401);
  });
});
