const test = require("node:test");
const assert = require("node:assert");
const { cadenaCufe, calcularCufe, fechaHoraColombia, urlVerificacion } = require("../src/utils/cufe");

// Ejemplo publicado en el Anexo Técnico de factura electrónica de la DIAN.
const EJEMPLO_DIAN = {
  numero_completo: "323200000129",
  fecha: "2019-01-16",
  hora: "10:53:10-05:00",
  subtotal: 1500000,
  total_iva: 285000,
  total_inc: 0,
  total: 1785000,
  nit_emisor: "700085371",
  num_adquiriente: "800199436",
  clave_tecnica: "693ff6f2a553c3646a063436fd4dd9ded0311471",
  ambiente: "produccion",
};

test("la cadena del CUFE sigue el orden y formato del anexo", () => {
  assert.strictEqual(
    cadenaCufe(EJEMPLO_DIAN),
    "3232000001292019-01-1610:53:10-05:001500000.0001285000.00040.00030.001785000.00" +
      "700085371800199436693ff6f2a553c3646a063436fd4dd9ded03114711"
  );
});

test("el CUFE coincide con el del ejemplo oficial de la DIAN", () => {
  assert.strictEqual(
    calcularCufe(EJEMPLO_DIAN),
    "8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4"
  );
});

test("Consumidor Final usa 222222222222 y el ambiente de pruebas usa 2", () => {
  const cadena = cadenaCufe({ ...EJEMPLO_DIAN, num_adquiriente: null, ambiente: "pruebas" });
  assert.ok(cadena.endsWith("700085371222222222222693ff6f2a553c3646a063436fd4dd9ded03114712"));
});

test("el NIT del emisor y del adquiriente van solo con dígitos", () => {
  const cadena = cadenaCufe({ ...EJEMPLO_DIAN, nit_emisor: "700.085.371", num_adquiriente: "800 199 436" });
  assert.strictEqual(cadena, cadenaCufe(EJEMPLO_DIAN));
});

test("sin clave técnica o con ambiente inválido no calcula", () => {
  assert.throws(() => calcularCufe({ ...EJEMPLO_DIAN, clave_tecnica: null }), /clave técnica/);
  assert.throws(() => calcularCufe({ ...EJEMPLO_DIAN, ambiente: "x" }), /Ambiente/);
});

test("la fecha UTC se convierte a hora de Colombia (incluso cruzando la medianoche)", () => {
  assert.deepStrictEqual(fechaHoraColombia("2026-09-27 01:15:00"), { fecha: "2026-09-26", hora: "20:15:00-05:00" });
  assert.deepStrictEqual(fechaHoraColombia("2026-09-26 15:00:09"), { fecha: "2026-09-26", hora: "10:00:09-05:00" });
});

test("la URL del QR depende del ambiente", () => {
  assert.strictEqual(urlVerificacion("abc", "produccion"), "https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=abc");
  assert.strictEqual(urlVerificacion("abc", "pruebas"), "https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=abc");
});
