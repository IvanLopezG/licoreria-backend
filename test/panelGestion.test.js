// Funciones puras del panel (public/panel/gestion.js): se prueban sin navegador.
const test = require("node:test");
const assert = require("node:assert");
const Gestion = require("../public/panel/gestion.js");
const { rangoPeriodo: rangoBackend } = require("../src/utils/periodoReporte");

test("hoy en Colombia (UTC-5) y fechas inválidas", () => {
  assert.strictEqual(Gestion.hoyColombia(new Date("2026-10-12T04:59:59Z")), "2026-10-11");
  assert.strictEqual(Gestion.hoyColombia(new Date("2026-10-12T05:00:00Z")), "2026-10-12");
  for (const malo of ["2026-02-30", "2026-13-01", "2026-1-5", "hoy", "", null, undefined]) {
    assert.strictEqual(Gestion.leerFecha(malo), null, String(malo));
  }
  assert.strictEqual(Gestion.fechaPermitida("2027-01-01", "2026-10-11"), "2026-10-11");
  assert.strictEqual(Gestion.fechaPermitida("2026-02-30", "2026-10-11"), "2026-10-11");
  assert.strictEqual(Gestion.fechaPermitida("2026-03-01", "2026-10-11"), "2026-03-01");
});

test("rango de cada periodo igual al del backend", () => {
  const fechas = ["2026-10-08", "2026-10-05", "2026-10-11", "2026-01-01", "2028-02-10", "2026-02-28", "2026-12-31", "2027-01-03"];
  for (const periodo of Gestion.PERIODOS) {
    for (const fecha of fechas) {
      assert.deepStrictEqual(Gestion.rangoPeriodo(periodo, fecha), rangoBackend(periodo, fecha), `${periodo} ${fecha}`);
    }
  }
  assert.strictEqual(Gestion.rangoPeriodo("trimestre", "2026-10-08"), null);
});

test("anterior y siguiente: fin de mes, bisiesto y nunca después de hoy", () => {
  const hoy = "2026-10-11";
  assert.strictEqual(Gestion.moverPeriodo("mes", "2026-03-31", -1), "2026-02-28");
  assert.strictEqual(Gestion.moverPeriodo("anio", "2028-02-29", 1), "2029-02-28");
  assert.strictEqual(Gestion.moverPeriodo("semana", "2026-10-11", -1), "2026-10-04");
  assert.strictEqual(Gestion.moverPeriodo("dia", "2026-01-01", -1), "2025-12-31");
  assert.strictEqual(Gestion.periodoSiguiente("dia", hoy, hoy), null);
  assert.strictEqual(Gestion.periodoSiguiente("semana", "2026-10-04", hoy), "2026-10-11");
  assert.strictEqual(Gestion.periodoSiguiente("mes", "2026-09-30", hoy), hoy); // octubre contiene hoy: no pasa de hoy
  assert.strictEqual(Gestion.periodoSiguiente("mes", "2026-08-31", hoy), "2026-09-30");
  assert.strictEqual(Gestion.periodoSiguiente("anio", "2026-03-01", hoy), null);
  assert.strictEqual(Gestion.periodoSiguiente("semana", "2026-10-08", "2026-10-13"), "2026-10-13");
});

test("rango en texto legible", () => {
  assert.strictEqual(Gestion.textoRango("semana", "2026-10-05", "2026-10-11"), "Lun 5 – Dom 11 oct 2026");
  assert.strictEqual(Gestion.textoRango("semana", "2026-09-28", "2026-10-04"), "Lun 28 sep – Dom 4 oct 2026");
  assert.strictEqual(Gestion.textoRango("semana", "2025-12-29", "2026-01-04"), "Lun 29 dic 2025 – Dom 4 ene 2026");
  assert.strictEqual(Gestion.textoRango("dia", "2026-10-11", "2026-10-11"), "Dom 11 oct 2026");
  assert.strictEqual(Gestion.textoRango("mes", "2026-10-01", "2026-10-31"), "Octubre 2026");
  assert.strictEqual(Gestion.textoRango("anio", "2026-01-01", "2026-12-31"), "2026");
  assert.strictEqual(Gestion.textoRango("mes", "2026-10-07", "2026-10-10"), "Mié 7 – Sáb 10 oct 2026");
  assert.strictEqual(Gestion.textoRango("dia", "malo", "2026-10-10"), "");
});

test("formato de pesos y números", () => {
  assert.strictEqual(Gestion.formatoPesos(152000), "$ 152.000");
  assert.strictEqual(Gestion.formatoPesos(50666.67), "$ 50.666,67");
  assert.strictEqual(Gestion.formatoPesos(1234567), "$ 1.234.567");
  assert.strictEqual(Gestion.formatoPesos(0), "$ 0");
  assert.strictEqual(Gestion.formatoPesos(999.5), "$ 999,50");
  assert.strictEqual(Gestion.formatoPesos("45000"), "$ 45.000");
  assert.strictEqual(Gestion.formatoPesos(null), "$ 0");
  assert.strictEqual(Gestion.formatoPesos("abc"), "$ 0");
  assert.strictEqual(Gestion.formatoPesos(-3500), "-$ 3.500");
  assert.strictEqual(Gestion.formatoNumero(12), "12");
  assert.strictEqual(Gestion.formatoNumero(2.5), "2,5");
  assert.strictEqual(Gestion.formatoNumero(0.05), "0,05");
  assert.strictEqual(Gestion.formatoNumero(1500), "1.500");
});

test("serie de la gráfica: vacía, un punto, semana y año agrupado por mes", () => {
  assert.deepStrictEqual(Gestion.serieGrafica("semana", []), []);
  assert.deepStrictEqual(Gestion.serieGrafica("dia", undefined), []);
  assert.deepStrictEqual(Gestion.serieGrafica("dia", [{ fecha: "2026-10-11", total: 0, numero_ventas: 0 }]), [
    { etiqueta: "11", titulo: "Dom 11 oct 2026", total: 0 },
  ]);
  assert.deepStrictEqual(
    Gestion.serieGrafica("semana", [
      { fecha: "2026-10-06", total: "2000" },
      { fecha: "2026-10-05", total: 1000 },
      { fecha: "mala", total: 9 },
      null,
    ]).map((p) => [p.etiqueta, p.total]),
    [["Lun", 1000], ["Mar", 2000]]
  );
  const anio = [];
  for (let d = new Date(Date.UTC(2026, 0, 1)); d.getUTCFullYear() === 2026; d.setUTCDate(d.getUTCDate() + 1)) {
    anio.push({ fecha: d.toISOString().slice(0, 10), total: d.getUTCMonth() === 1 ? 10 : 0 });
  }
  const meses = Gestion.serieGrafica("anio", anio);
  assert.strictEqual(meses.length, 12);
  assert.deepStrictEqual(meses[1], { etiqueta: "feb", titulo: "Febrero 2026", total: 280 });
  assert.strictEqual(meses[0].total, 0);
});

test("geometría de las barras: vacía, un punto, todo en cero y mínimo visible", () => {
  assert.deepStrictEqual(Gestion.geometriaBarras([], 300, 100), []);
  const uno = Gestion.geometriaBarras([{ total: 5 }], 300, 100);
  assert.strictEqual(uno.length, 1);
  assert.strictEqual(uno[0].alto, 100);
  assert.strictEqual(uno[0].y, 0);
  const ceros = Gestion.geometriaBarras([{ total: 0 }, { total: 0 }], 300, 100);
  assert.ok(ceros.every((b) => b.alto === 0 && b.y === 100 && Number.isFinite(b.x)));
  const [grande, chico] = Gestion.geometriaBarras([{ total: 100000 }, { total: 1 }], 300, 100);
  assert.strictEqual(grande.alto, 100);
  assert.strictEqual(chico.alto, 2);
});

test("alertas agrupadas por estado; desconocidos ignorados; texto de cobertura", () => {
  const p = (nombre, estado, dias_cobertura = 1.5) => ({ nombre, estado, dias_cobertura });
  const grupos = Gestion.agruparAlertas([
    p("Kirsch", "por_agotarse"),
    p("Aguardiente", "agotado"),
    p("Hielo", "ok"),
    p("Vino", "reservado"),
    null,
    p("Cerveza", "bajo_minimo", null),
    p("Brandy", "agotado", null),
  ]);
  assert.deepStrictEqual(grupos.map((g) => [g.estado, g.titulo, g.productos.map((x) => x.nombre)]), [
    ["agotado", "Agotado", ["Aguardiente", "Brandy"]],
    ["bajo_minimo", "Bajo mínimo", ["Cerveza"]],
    ["por_agotarse", "Por agotarse", ["Kirsch"]],
  ]);
  assert.strictEqual(Gestion.contarAlertas([p("A", "agotado"), p("B", "ok"), p("C", "raro")]), 1);
  assert.deepStrictEqual(Gestion.agruparAlertas(undefined), []);
  assert.strictEqual(Gestion.textoCobertura(4.5), "4,5 días");
  assert.strictEqual(Gestion.textoCobertura(1), "1 día");
  assert.strictEqual(Gestion.textoCobertura(0), "0 días");
  assert.strictEqual(Gestion.textoCobertura(null), "—");
  assert.ok(Gestion.sinVentasRecientes(p("x", "agotado", null)));
  assert.ok(!Gestion.sinVentasRecientes(p("x", "agotado", 0)));
  assert.strictEqual(
    Gestion.SIN_VENTAS_RECIENTES,
    "Sin ventas recientes: no se calcula cobertura; se sugiere reponer hasta el doble del mínimo."
  );
});

test("asistente: límite de 500 caracteres, etiqueta de origen y manejo de errores", () => {
  assert.strictEqual(Gestion.contarCaracteres("ñandú"), 5);
  assert.strictEqual(Gestion.contarCaracteres("🍾🍾"), 2);
  assert.strictEqual(Gestion.limitarMensaje("a".repeat(600)).length, 500);
  assert.strictEqual(Gestion.contarCaracteres(Gestion.limitarMensaje("🍾".repeat(600))), 500);
  assert.strictEqual(Gestion.etiquetaOrigen("ia"), "IA");
  for (const otro of ["basico", "", undefined, null, "IA", "otro"]) assert.strictEqual(Gestion.etiquetaOrigen(otro), "Rápida");

  assert.deepStrictEqual(Gestion.errorAsistente({ status: 401 }).irAlLogin, true);
  assert.deepStrictEqual(Gestion.errorAsistente({ status: 403 }), {
    texto: "No tienes permiso para usar el asistente", reintentable: false, bloquear: true, irAlLogin: false,
  });
  assert.deepStrictEqual(Gestion.errorAsistente({ status: 429, mensaje: "Demasiados mensajes" }), {
    texto: "Espera un momento antes de enviar otro mensaje", reintentable: true, bloquear: false, irAlLogin: false,
  });
  assert.deepStrictEqual(Gestion.errorAsistente({ status: 400, mensaje: "El mensaje no puede estar vacío." }), {
    texto: "El mensaje no puede estar vacío.", reintentable: false, bloquear: false, irAlLogin: false,
  });
  assert.match(Gestion.errorAsistente({ status: 0, tiempoAgotado: true }).texto, /tardó demasiado/);
  assert.strictEqual(Gestion.errorAsistente({ status: 0, tiempoAgotado: true }).reintentable, true);
  assert.strictEqual(Gestion.errorAsistente({ status: 502, mensaje: "Error del servidor (502)." }).reintentable, true);
});
