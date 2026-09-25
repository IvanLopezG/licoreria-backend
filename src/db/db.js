require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { Pool, types } = require("pg");

const SCHEMA_PATH = path.join(__dirname, "schema.sql");

// La API debe devolver los mismos JSON que con SQLite:
// - bigint (COUNT, SUM) y numeric llegan de pg como texto; se convierten a número.
// - timestamp (sin zona) llega como texto "YYYY-MM-DD HH:MM:SS" (UTC, ver
//   schema.sql) y se deja así, en vez de convertirlo a Date.
types.setTypeParser(types.builtins.INT8, (valor) => Number(valor));
types.setTypeParser(types.builtins.NUMERIC, (valor) => Number(valor));
types.setTypeParser(types.builtins.TIMESTAMP, (valor) => valor);
types.setTypeParser(types.builtins.DATE, (valor) => valor);

if (!process.env.DATABASE_URL) {
  throw new Error("Falta la variable de entorno DATABASE_URL (cadena de conexión de Postgres).");
}

// Supabase exige SSL. rejectUnauthorized: false acepta la cadena de
// certificados del pooler de Supabase sin tener que instalar su CA.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX) || 10,
});

// El texto de un timestamp depende de DateStyle; con el valor por defecto de
// Postgres y de Supabase (ISO) sale como "2026-09-24 03:53:39".

pool.on("error", (err) => {
  console.error("Error en una conexión inactiva de Postgres:", err.message);
});

// SQLite guardaba NaN como NULL (p. ej. GET /api/mesas/abc → "no encontrada");
// Postgres lo rechazaría como entero inválido. Se replica el comportamiento.
function limpiarParametros(params = []) {
  return params.map((p) => (typeof p === "number" && Number.isNaN(p) ? null : p));
}

// Mismo juego de funciones para el pool y para el client de una transacción,
// así los modelos reciben cualquiera de los dos como "cx".
function crearConsultas(ejecutor) {
  const ejecutar = (texto, params) => ejecutor.query(texto, limpiarParametros(params));
  return {
    ejecutar,
    uno: async (texto, params) => (await ejecutar(texto, params)).rows[0],
    todos: async (texto, params) => (await ejecutar(texto, params)).rows,
  };
}

const db = crearConsultas(pool);

// Operaciones atómicas: un solo client del pool con BEGIN/COMMIT/ROLLBACK,
// y la conexión se libera siempre en finally.
async function conTransaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(crearConsultas(client));
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function inicializarEsquema() {
  await pool.query(fs.readFileSync(SCHEMA_PATH, "utf8"));
}

// Filtros ?desde= / ?hasta= (yyyy-MM-dd). Con SQLite, date() de un texto que no
// es fecha daba NULL y el filtro no devolvía filas; aquí se devuelve null para
// que el modelo agregue una condición falsa en vez de un error de Postgres.
function fechaFiltro(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.exec(String(valor));
  if (!m) return null;
  const [anio, mes, dia] = m.slice(1).map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  // date() de SQLite normaliza días fuera de rango (2026-02-30 → 2026-03-02).
  return new Date(Date.UTC(anio, mes - 1, dia)).toISOString().slice(0, 10);
}

// Arma el WHERE de los listados con placeholders $1, $2... en orden.
function filtros() {
  const condiciones = [];
  const params = [];
  return {
    params,
    agregar(sqlConMarcador, valor) {
      params.push(valor);
      condiciones.push(sqlConMarcador.replace("?", `$${params.length}`));
    },
    agregarFijo(sql) {
      condiciones.push(sql);
    },
    // Rango de fechas sobre una columna timestamp, como date(col) >= date(?) en SQLite.
    agregarFecha(columna, operador, valor) {
      const fecha = fechaFiltro(valor);
      if (fecha === null) condiciones.push("FALSE");
      else this.agregar(`${columna}::date ${operador} ?::date`, fecha);
    },
    where() {
      return condiciones.length ? ` AND ${condiciones.join(" AND ")}` : "";
    },
  };
}

module.exports = { ...db, pool, conTransaccion, inicializarEsquema, filtros };
