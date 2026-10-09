// CSV del reporte de ventas (GET /api/ventas?formato=csv): sin &excel=1 sale
// el de siempre byte a byte; con &excel=1, el formato para Excel en Colombia.
// Controlador real con ventaService.listarVentas reemplazado: sin base de datos.
process.env.DATABASE_URL = "postgresql://prueba:prueba@127.0.0.1:1/sin_base";

const test = require("node:test");
const assert = require("node:assert");
const ventaService = require("../src/services/ventaService");
const ventaController = require("../src/controllers/ventaController");

const VENTAS = [
  {
    id_venta: 12, tipo: "mesa", mesa_numero: 3, usuario_nombre: "Andrés; cajero", total: 45000.5,
    estado: "activa", id_factura: 9, numero_factura: "FV-0012", fecha_hora: "2026-10-09 15:04:31",
  },
  {
    id_venta: 13, tipo: "mostrador", mesa_numero: null, usuario_nombre: 'María "la jefa", admin', total: 3800,
    estado: "anulada", id_factura: 10, numero_factura: "0001234", fecha_hora: "2026-10-09 16:00:00",
  },
  {
    id_venta: 14, tipo: "mostrador", mesa_numero: null, usuario_nombre: "Ñoño\nPérez", total: 0.75,
    estado: "activa", id_factura: null, numero_factura: null, fecha_hora: "2026-10-10 01:02:03",
  },
];

// Respuesta mínima de Express que guarda lo enviado.
function respuestaFalsa() {
  return {
    encabezados: {},
    cuerpo: undefined,
    datosJson: undefined,
    setHeader(nombre, valor) { this.encabezados[nombre] = valor; },
    send(cuerpo) { this.cuerpo = cuerpo; return this; },
    json(datos) { this.datosJson = datos; return this; },
  };
}

async function listar(query) {
  let filtro;
  ventaService.listarVentas = async (f) => { filtro = f; return VENTAS; };
  const res = respuestaFalsa();
  await ventaController.listar({ query }, res);
  return { res, filtro };
}

test("sin excel=1: el CSV de siempre (coma, \\n, sin BOM) y los mismos encabezados", async () => {
  const { res } = await listar({ formato: "csv" });
  assert.strictEqual(res.encabezados["Content-Type"], "text/csv; charset=utf-8");
  assert.strictEqual(res.encabezados["Content-Disposition"], "attachment; filename=reporte_ventas.csv");
  assert.strictEqual(
    res.cuerpo,
    [
      "id_venta,tipo,mesa_numero,usuario,total,estado,factura,fecha_hora",
      "12,mesa,3,Andrés; cajero,45000.5,activa,FV-0012,2026-10-09 15:04:31",
      '13,mostrador,,"María ""la jefa"", admin",3800,anulada,0001234,2026-10-09 16:00:00',
      '14,mostrador,,"Ñoño\nPérez",0.75,activa,,2026-10-10 01:02:03',
    ].join("\n")
  );
});

test("excel=1: BOM, punto y coma, CRLF, total con coma decimal y factura numérica como texto", async () => {
  const { res } = await listar({ formato: "csv", excel: "1" });
  assert.strictEqual(res.encabezados["Content-Type"], "text/csv; charset=utf-8");
  assert.strictEqual(res.encabezados["Content-Disposition"], "attachment; filename=reporte_ventas.csv");
  assert.ok(res.cuerpo.startsWith("﻿"));
  assert.strictEqual(
    res.cuerpo.slice(1),
    [
      "id_venta;tipo;mesa_numero;usuario;total;estado;factura;fecha_hora",
      '12;mesa;3;"Andrés; cajero";"45000,5";activa;FV-0012;2026-10-09 15:04:31',
      '13;mostrador;;"María ""la jefa"", admin";3800;anulada;"=""0001234""";2026-10-09 16:00:00',
      '14;mostrador;;"Ñoño\nPérez";"0,75";activa;;2026-10-10 01:02:03',
    ].join("\r\n")
  );
});

test("cualquier otro valor de excel deja el CSV de siempre", async () => {
  const { res: base } = await listar({ formato: "csv" });
  for (const excel of ["0", "true", "", "si"]) {
    const { res } = await listar({ formato: "csv", excel });
    assert.strictEqual(res.cuerpo, base.cuerpo, `excel=${excel}`);
  }
});

test("el CSV usa los mismos filtros que el JSON", async () => {
  const query = { desde: "2026-10-01", hasta: "2026-10-09", tipo: "mesa", incluir_anuladas: "true" };
  const { filtro: deJson } = await listar(query);
  const { filtro: deCsv } = await listar({ ...query, formato: "csv", excel: "1" });
  assert.deepStrictEqual(deCsv, deJson);
  assert.deepStrictEqual(deCsv, { desde: "2026-10-01", hasta: "2026-10-09", tipo: "mesa", incluir_anuladas: true });
});

test("sin formato=csv la respuesta JSON no cambia (aunque llegue excel=1)", async () => {
  const { res } = await listar({ excel: "1" });
  assert.strictEqual(res.datosJson, VENTAS);
  assert.strictEqual(res.cuerpo, undefined);
});
