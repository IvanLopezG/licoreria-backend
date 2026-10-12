// GET /api/reportes?periodo=dia|semana|mes|anio[&fecha=AAAA-MM-DD]
//
// 1) Rangos de cada periodo y validaciones: sin base de datos, siempre corren.
// 2) Integración por HTTP con la app real, datos de prueba y cada periodo: solo
//    con un Postgres LOCAL desechable y recién creado (sin productos):
//      PRUEBA_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npm test
//    Sin esa variable, o si apunta fuera de localhost o la base ya tiene
//    productos, se salta (nunca borra nada y nunca corre contra Supabase).
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
const { rangoPeriodo } = require("../src/utils/periodoReporte");
const reporteService = require("../src/services/reporteService");
const { ErrorValidacion } = require("../src/utils/errores");
const { hoyColombia } = require("../src/utils/fechaColombia");

// ---------- 1) Rangos y validaciones ----------

test("rango de cada periodo (semana de lunes a domingo, fechas de Colombia)", () => {
  const casos = [
    ["dia", "2026-10-08", "2026-10-08", "2026-10-08"],
    ["semana", "2026-10-08", "2026-10-05", "2026-10-11"], // jueves
    ["semana", "2026-10-05", "2026-10-05", "2026-10-11"], // lunes
    ["semana", "2026-10-11", "2026-10-05", "2026-10-11"], // domingo
    ["semana", "2026-01-01", "2025-12-29", "2026-01-04"], // cruza el año
    ["mes", "2026-10-08", "2026-10-01", "2026-10-31"],
    ["mes", "2028-02-10", "2028-02-01", "2028-02-29"], // bisiesto
    ["mes", "2026-02-28", "2026-02-01", "2026-02-28"],
    ["mes", "2026-12-31", "2026-12-01", "2026-12-31"],
    ["anio", "2026-10-08", "2026-01-01", "2026-12-31"],
  ];
  for (const [periodo, fecha, desde, hasta] of casos) {
    assert.deepStrictEqual(rangoPeriodo(periodo, fecha), { desde, hasta }, `${periodo} ${fecha}`);
  }
});

test("rango: periodo o fecha inválidos → null", () => {
  for (const [periodo, fecha] of [
    ["año", "2026-10-08"], ["", "2026-10-08"], [undefined, "2026-10-08"], ["DIA", "2026-10-08"],
    ["dia", "2026-02-30"], ["dia", "2026-13-01"], ["dia", "2026-1-5"], ["dia", "08/10/2026"], ["dia", "2026-10-08T10:00"],
  ]) {
    assert.strictEqual(rangoPeriodo(periodo, fecha), null, `${periodo} ${fecha}`);
  }
});

test("servicio: periodo obligatorio y válido, fecha válida (400 antes de consultar la base)", async () => {
  for (const periodo of [undefined, "", "año", "semanal", "Mes"]) {
    await assert.rejects(reporteService.porPeriodo({ periodo }), (err) => {
      assert.ok(err instanceof ErrorValidacion);
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.message, "periodo es obligatorio. Debe ser uno de: dia, semana, mes, anio.");
      return true;
    });
  }
  for (const fecha of ["2026-02-30", "hoy", "2026/10/08", "2026-10-08 10:00"]) {
    await assert.rejects(reporteService.porPeriodo({ periodo: "dia", fecha }), (err) => {
      assert.ok(err instanceof ErrorValidacion);
      assert.strictEqual(err.message, "fecha debe ser una fecha válida con formato AAAA-MM-DD.");
      return true;
    });
  }
});

// ---------- 2) Integración con datos de prueba ----------

// Fechas en UTC (como se guardan) y su día en Colombia (UTC-5) al lado.
const FECHA_REF = "2026-10-08"; // jueves; semana 2026-10-05 … 2026-10-11

test("integración: GET /api/reportes con datos de prueba en cada periodo", { skip: !BASE_LOCAL && "sin PRUEBA_DATABASE_URL local" }, async (t) => {
  const db = require("../src/db/db");
  const bcrypt = require("bcryptjs");
  const app = require("../src/app");

  await db.inicializarEsquema();
  const { n } = await db.uno("SELECT COUNT(*) AS n FROM productos");
  if (n > 0) {
    await db.pool.end();
    t.skip("la base ya tiene productos: se necesita una base recién creada para totales exactos");
    return;
  }

  // Usuarios de cada rol (la contraseña solo existe en esta prueba).
  const clave = "Prueba123!";
  const password_hash = bcrypt.hashSync(clave, 4);
  const ids = {};
  for (const rol of ["administrador", "cajero", "mesero"]) {
    const u = await db.uno(
      `INSERT INTO usuarios (nombre, usuario_login, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id_usuario`,
      [`${rol} reportes`, `${rol}_reportes`, password_hash, rol]
    );
    ids[rol] = u.id_usuario;
  }
  const { id_categoria } = await db.uno(
    "INSERT INTO categorias (nombre) VALUES ('Categoría reportes') RETURNING id_categoria"
  );

  const producto = async (nombre, precio, activo = 1) =>
    (await db.uno(
      `INSERT INTO productos (id_categoria, nombre, unidad_medida, precio, stock_actual, umbral_alerta, activo)
       VALUES ($1, $2, 'unidad', $3, 100, 5, $4) RETURNING id_producto`,
      [id_categoria, nombre, precio, activo]
    )).id_producto;
  const P = {
    A: await producto("Aguardiente", 45000),
    B: await producto("Ron", 52000),
    C: await producto("Cerveza", 3500),
    D: await producto("Papas", 2500), // activo, nunca vendido
    E: await producto("Vino viejo", 30000, 0), // inactivo, nunca vendido: no aparece
    F: await producto("Whisky", 120000, 0), // inactivo, vendido en febrero: aparece en el año
  };

  const venta = async (fecha_hora, lineas, estado = "activa") => {
    const total = lineas.reduce((s, [, cant, precio]) => s + cant * precio, 0);
    const { id_venta } = await db.uno(
      `INSERT INTO ventas (tipo, id_usuario, total, fecha_hora, estado) VALUES ('mostrador', $1, $2, $3, $4) RETURNING id_venta`,
      [ids.cajero, total, fecha_hora, estado]
    );
    for (const [id_producto, cantidad, precio_unitario] of lineas) {
      await db.ejecutar(
        "INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)",
        [id_venta, id_producto, cantidad, precio_unitario]
      );
    }
  };
  await venta("2026-10-08 15:00:00", [[P.A, 2, 45000], [P.C, 5, 3500]]); // 10-08 10:00 → 107500
  await venta("2026-10-09 04:30:00", [[P.B, 1, 52000]]); // 10-08 23:30 → 52000
  await venta("2026-10-08 04:59:59", [[P.C, 10, 3500]]); // 10-07 23:59:59 → 35000
  await venta("2026-10-08 12:00:00", [[P.A, 100, 45000]], "anulada"); // anulada: no cuenta nunca
  await venta("2026-10-12 06:00:00", [[P.A, 1, 45000]]); // 10-12 (lunes siguiente) → 45000
  await venta("2026-10-05 04:00:00", [[P.C, 2, 3500]]); // 10-04 (domingo anterior) → 7000
  await venta("2026-02-10 18:00:00", [[P.F, 3, 120000]]); // febrero → 360000
  await venta("2027-01-01 04:00:00", [[P.B, 2, 52000]]); // 2026-12-31 23:00 → 104000
  await venta("2026-01-01 03:00:00", [[P.A, 7, 45000]]); // 2025-12-31 22:00: fuera de 2026

  const mov = (id_producto, tipo, motivo, cantidad, fecha_hora) =>
    db.ejecutar(
      `INSERT INTO movimientos_inventario (id_producto, tipo, motivo, cantidad, id_usuario, fecha_hora)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id_producto, tipo, motivo, cantidad, ids.cajero, fecha_hora]
    );
  await mov(P.A, "entrada", "compra", 24, "2026-10-08 14:00:00"); // día
  await mov(P.A, "entrada", "anulacion", 100, "2026-10-08 13:00:00"); // día
  await mov(P.C, "salida", "venta", 5, "2026-10-08 15:00:00"); // día
  await mov(P.B, "salida", "ajuste", 2, "2026-10-09 04:30:00"); // 10-08 23:30: día
  await mov(P.D, "salida", "ajuste", 1, "2026-10-06 15:00:00"); // semana
  await mov(P.C, "entrada", "compra", 50, "2026-10-20 15:00:00"); // mes
  await mov(P.F, "salida", "venta", 3, "2026-02-10 18:00:00"); // año
  await mov(P.A, "entrada", "compra", 9, "2026-10-12 04:00:00"); // 10-11 23:00: semana

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
      body: JSON.stringify({ usuario_login: `${rol}_reportes`, password: clave }),
    });
    return (await r.json()).token;
  };
  const tokens = { administrador: await login("administrador"), cajero: await login("cajero"), mesero: await login("mesero") };
  const pedir = async (query, token = tokens.cajero) => {
    const r = await fetch(`${base}/reportes${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: r.status, body: await r.json() };
  };
  const productos = (lista) => lista.map((p) => [p.nombre, p.unidades, p.total]);
  const dias = (serie) => serie.filter((d) => d.numero_ventas > 0).map((d) => [d.fecha, d.total, d.numero_ventas]);

  await t.test("dia", async () => {
    const { status, body } = await pedir(`?periodo=dia&fecha=${FECHA_REF}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.periodo, "dia");
    assert.strictEqual(body.fecha_referencia, FECHA_REF);
    assert.deepStrictEqual(body.rango, { desde: "2026-10-08", hasta: "2026-10-08", zona_horaria: "America/Bogota" });
    assert.strictEqual(body.total_vendido, 159500);
    assert.strictEqual(body.numero_ventas, 2);
    assert.strictEqual(body.ticket_promedio, 79750);
    assert.deepStrictEqual(productos(body.top_productos), [["Cerveza", 5, 17500], ["Aguardiente", 2, 90000], ["Ron", 1, 52000]]);
    assert.ok(body.top_productos.every((p) => Number.isInteger(p.id_producto)));
    assert.deepStrictEqual(productos(body.productos_menos_vendidos), [
      ["Papas", 0, 0], ["Ron", 1, 52000], ["Aguardiente", 2, 90000], ["Cerveza", 5, 17500],
    ]);
    assert.deepStrictEqual(body.movimientos_inventario, {
      entradas: { movimientos: 2, unidades: 124 },
      salidas: { movimientos: 1, unidades: 5 },
      ajustes: { movimientos: 1, unidades: 2 },
    });
    assert.deepStrictEqual(body.ventas_por_dia, [{ fecha: "2026-10-08", total: 159500, numero_ventas: 2 }]);
  });

  await t.test("semana (lunes a domingo)", async () => {
    const { body } = await pedir(`?periodo=semana&fecha=${FECHA_REF}`);
    assert.deepStrictEqual(body.rango, { desde: "2026-10-05", hasta: "2026-10-11", zona_horaria: "America/Bogota" });
    assert.strictEqual(body.total_vendido, 194500);
    assert.strictEqual(body.numero_ventas, 3);
    assert.strictEqual(body.ticket_promedio, 64833.33);
    assert.deepStrictEqual(productos(body.top_productos), [["Cerveza", 15, 52500], ["Aguardiente", 2, 90000], ["Ron", 1, 52000]]);
    assert.deepStrictEqual(body.movimientos_inventario, {
      entradas: { movimientos: 3, unidades: 133 },
      salidas: { movimientos: 1, unidades: 5 },
      ajustes: { movimientos: 2, unidades: 3 },
    });
    assert.strictEqual(body.ventas_por_dia.length, 7);
    assert.deepStrictEqual(body.ventas_por_dia[0], { fecha: "2026-10-05", total: 0, numero_ventas: 0 });
    assert.strictEqual(body.ventas_por_dia[6].fecha, "2026-10-11");
    assert.deepStrictEqual(dias(body.ventas_por_dia), [["2026-10-07", 35000, 1], ["2026-10-08", 159500, 2]]);
  });

  await t.test("mes", async () => {
    const { body } = await pedir(`?periodo=mes&fecha=${FECHA_REF}`);
    assert.deepStrictEqual(body.rango, { desde: "2026-10-01", hasta: "2026-10-31", zona_horaria: "America/Bogota" });
    assert.strictEqual(body.total_vendido, 246500);
    assert.strictEqual(body.numero_ventas, 5);
    assert.strictEqual(body.ticket_promedio, 49300);
    assert.deepStrictEqual(productos(body.top_productos), [["Cerveza", 17, 59500], ["Aguardiente", 3, 135000], ["Ron", 1, 52000]]);
    assert.deepStrictEqual(body.movimientos_inventario, {
      entradas: { movimientos: 4, unidades: 183 },
      salidas: { movimientos: 1, unidades: 5 },
      ajustes: { movimientos: 2, unidades: 3 },
    });
    assert.strictEqual(body.ventas_por_dia.length, 31);
    assert.deepStrictEqual(dias(body.ventas_por_dia), [
      ["2026-10-04", 7000, 1], ["2026-10-07", 35000, 1], ["2026-10-08", 159500, 2], ["2026-10-12", 45000, 1],
    ]);
  });

  await t.test("anio (incluye la venta del 31 de diciembre a las 11 p. m., no la del 31 de diciembre anterior)", async () => {
    const { body } = await pedir(`?periodo=anio&fecha=${FECHA_REF}`);
    assert.deepStrictEqual(body.rango, { desde: "2026-01-01", hasta: "2026-12-31", zona_horaria: "America/Bogota" });
    assert.strictEqual(body.total_vendido, 710500);
    assert.strictEqual(body.numero_ventas, 7);
    assert.strictEqual(body.ticket_promedio, 101500);
    // Empate en unidades (3): primero el de más dinero.
    assert.deepStrictEqual(productos(body.top_productos), [
      ["Cerveza", 17, 59500], ["Whisky", 3, 360000], ["Ron", 3, 156000], ["Aguardiente", 3, 135000],
    ]);
    // Whisky está inactivo pero se vendió en el año; Vino viejo (inactivo, sin ventas) no aparece.
    assert.deepStrictEqual(productos(body.productos_menos_vendidos), [
      ["Papas", 0, 0], ["Aguardiente", 3, 135000], ["Ron", 3, 156000], ["Whisky", 3, 360000], ["Cerveza", 17, 59500],
    ]);
    assert.deepStrictEqual(body.movimientos_inventario, {
      entradas: { movimientos: 4, unidades: 183 },
      salidas: { movimientos: 2, unidades: 8 },
      ajustes: { movimientos: 2, unidades: 3 },
    });
    assert.strictEqual(body.ventas_por_dia.length, 365);
    assert.deepStrictEqual(body.ventas_por_dia.at(-1), { fecha: "2026-12-31", total: 104000, numero_ventas: 1 });
    assert.deepStrictEqual(body.ventas_por_dia[0], { fecha: "2026-01-01", total: 0, numero_ventas: 0 });
    assert.strictEqual(body.ventas_por_dia.reduce((s, d) => s + d.total, 0), body.total_vendido);
  });

  await t.test("periodo sin ventas: ceros, listas vacías y serie completa", async () => {
    const { status, body } = await pedir("?periodo=mes&fecha=2026-03-15");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.total_vendido, 0);
    assert.strictEqual(body.numero_ventas, 0);
    assert.strictEqual(body.ticket_promedio, 0);
    assert.deepStrictEqual(body.top_productos, []);
    assert.deepStrictEqual(productos(body.productos_menos_vendidos), [
      ["Aguardiente", 0, 0], ["Cerveza", 0, 0], ["Papas", 0, 0], ["Ron", 0, 0],
    ]);
    assert.deepStrictEqual(body.movimientos_inventario, {
      entradas: { movimientos: 0, unidades: 0 },
      salidas: { movimientos: 0, unidades: 0 },
      ajustes: { movimientos: 0, unidades: 0 },
    });
    assert.strictEqual(body.ventas_por_dia.length, 31);
  });

  await t.test("sin fecha: hoy en Colombia", async () => {
    const { status, body } = await pedir("?periodo=dia");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.fecha_referencia, hoyColombia());
    assert.deepStrictEqual(body.rango, { desde: hoyColombia(), hasta: hoyColombia(), zona_horaria: "America/Bogota" });
  });

  await t.test("validación (400), roles (administrador y cajero sí; mesero 403; sin token 401)", async () => {
    assert.deepStrictEqual(await pedir(""), {
      status: 400, body: { error: "periodo es obligatorio. Debe ser uno de: dia, semana, mes, anio." },
    });
    assert.strictEqual((await pedir("?periodo=trimestre")).status, 400);
    assert.deepStrictEqual(await pedir("?periodo=mes&fecha=2026-02-30"), {
      status: 400, body: { error: "fecha debe ser una fecha válida con formato AAAA-MM-DD." },
    });
    assert.strictEqual((await pedir(`?periodo=dia&fecha=${FECHA_REF}`, tokens.administrador)).status, 200);
    assert.strictEqual((await pedir(`?periodo=dia&fecha=${FECHA_REF}`, tokens.mesero)).status, 403);
    assert.strictEqual((await pedir(`?periodo=dia&fecha=${FECHA_REF}`, null)).status, 401);
  });
});
