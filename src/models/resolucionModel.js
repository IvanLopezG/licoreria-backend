const db = require("../db/db");

// Resoluciones de numeración (tabla secuencias_factura). La clave técnica se
// lee solo para saber si está configurada: ninguna función la devuelve.

const COLUMNAS_PUBLICAS = `
  id_secuencia, prefijo, numero_actual, rango_desde, rango_hasta, resolucion_numero,
  resolucion_fecha, vigencia_desde, vigencia_hasta, activa, fecha_registro,
  (clave_tecnica IS NOT NULL AND clave_tecnica <> '') AS clave_tecnica_configurada
`;

// Activa, bloqueada hasta el fin de la transacción: la emisión de facturas
// también toma esta fila con FOR UPDATE, así una factura y un cambio de
// resolución no se cruzan.
function activaParaActualizar(cx) {
  return cx.uno(`SELECT ${COLUMNAS_PUBLICAS} FROM secuencias_factura WHERE activa = 1 FOR UPDATE`);
}

function activa(cx = db) {
  return cx.uno(`SELECT ${COLUMNAS_PUBLICAS} FROM secuencias_factura WHERE activa = 1`);
}

function historicas(cx = db) {
  return cx.todos(
    `SELECT ${COLUMNAS_PUBLICAS} FROM secuencias_factura WHERE activa = 0 ORDER BY id_secuencia DESC`
  );
}

async function contarFacturas(id_secuencia, cx = db) {
  const { n } = await cx.uno("SELECT COUNT(*) AS n FROM facturas WHERE id_secuencia = $1", [id_secuencia]);
  return n;
}

// Último número ya emitido con un prefijo (NULL = sin prefijo) en cualquier
// resolución, activa o histórica; 0 si nunca se usó. Sale de las facturas
// (anuladas incluidas: su número no se reutiliza), no de numero_actual, que en
// una resolución sin usar vale rango_desde - 1 sin haber emitido nada.
async function ultimoNumeroConPrefijo(prefijo, cx = db) {
  const { ultimo } = await cx.uno(
    `SELECT COALESCE(MAX(f.numero), 0) AS ultimo
     FROM facturas f
     JOIN secuencias_factura s ON s.id_secuencia = f.id_secuencia
     WHERE s.prefijo IS NOT DISTINCT FROM $1`,
    [prefijo]
  );
  return ultimo;
}

const CAMPOS = [
  "prefijo", "numero_actual", "rango_desde", "rango_hasta", "resolucion_numero",
  "resolucion_fecha", "vigencia_desde", "vigencia_hasta",
];

// Registra una resolución nueva como activa y deja la anterior como histórica.
// Debe llamarse dentro de una transacción (cx).
async function registrar(datos, cx) {
  await cx.ejecutar("UPDATE secuencias_factura SET activa = 0 WHERE activa = 1");
  const columnas = [...CAMPOS, "clave_tecnica", "activa"];
  const { id_secuencia } = await cx.uno(
    `INSERT INTO secuencias_factura (${columnas.join(", ")})
     VALUES (${columnas.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING id_secuencia`,
    [...CAMPOS.map((c) => datos[c]), datos.clave_tecnica ?? null, 1]
  );
  return id_secuencia;
}

// Actualiza la resolución activa (solo si aún no emitió facturas, lo decide el
// servicio). clave_tecnica undefined = se conserva la guardada.
async function actualizar(id_secuencia, datos, cx) {
  const columnas = [...CAMPOS];
  const valores = CAMPOS.map((c) => datos[c]);
  if (datos.clave_tecnica !== undefined) {
    columnas.push("clave_tecnica");
    valores.push(datos.clave_tecnica);
  }
  await cx.ejecutar(
    `UPDATE secuencias_factura SET ${columnas.map((c, i) => `${c} = $${i + 1}`).join(", ")}
     WHERE id_secuencia = $${columnas.length + 1}`,
    [...valores, id_secuencia]
  );
}

module.exports = { activaParaActualizar, activa, historicas, contarFacturas, ultimoNumeroConPrefijo, registrar, actualizar };
