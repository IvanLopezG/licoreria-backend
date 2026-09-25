// Compara dos carpetas de muestras (escenario-api.js) respuesta por respuesta:
// mismo status y content-type, mismos campos en el mismo orden, mismos tipos
// JSON y mismos valores. Los valores que cambian en cada corrida (fechas,
// token QR, imagen del QR) se comparan por formato en vez de por valor.
//
// Uso: node scripts/comparar-muestras.js sqlite postgres
const fs = require("fs");
const path = require("path");

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("Uso: node scripts/comparar-muestras.js <carpetaA> <carpetaB>");
  process.exit(1);
}
const dirA = path.join(__dirname, "..", "muestras", a);
const dirB = path.join(__dirname, "..", "muestras", b);

const FECHA_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const TOKEN_QR = /^[0-9a-f]{32}$/;
const CAMPOS_FECHA = new Set(["fecha_hora", "fecha_creacion", "fecha_expedicion", "fecha_anulacion"]);

function tipo(valor) {
  if (valor === null) return "null";
  if (Array.isArray(valor)) return "array";
  return typeof valor;
}

// Normaliza lo que varía entre corridas, verificando antes su formato.
function normalizarTexto(clave, valor, ruta, errores) {
  if (CAMPOS_FECHA.has(clave)) {
    if (!FECHA_UTC.test(valor)) errores.push(`${ruta}: fecha con formato inesperado "${valor}"`);
    return "<fecha>";
  }
  if (clave === "codigo_qr_token" || clave === "token") {
    if (clave === "codigo_qr_token" && !TOKEN_QR.test(valor)) errores.push(`${ruta}: token QR con formato inesperado`);
    return "<token>";
  }
  if (clave === "qr_data_url") {
    if (!valor.startsWith("data:image/png;base64,")) errores.push(`${ruta}: qr_data_url no es un PNG en base64`);
    return "<png>";
  }
  if (clave === "url") return valor.replace(/token=[0-9a-f]{32}/, "token=<token>").replace(/^https?:\/\/[^/]+/, "<base>");
  if (clave === "ruta") return valor.replace(/\/catalogo\/[0-9a-f]{32}/, "/catalogo/<token>");
  // CSV: la columna de fecha cambia entre corridas y el orden de las filas
  // depende de ella; se comparan las filas sin importar el orden.
  if (clave === "body") {
    const [encabezado, ...filas] = valor.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "<fecha>").split("\n");
    return [encabezado, ...filas.sort()].join("\n");
  }
  return valor;
}

// Las listas ordenadas por fecha_hora dependen de cuánto tardó cada corrida
// (con SQLite local casi todo cae en el mismo segundo; con Supabase no). Se
// comparan ordenadas por su id y el orden se verifica aparte (verificarOrden).
function ordenarPorId(lista) {
  const id = lista.length && tipo(lista[0]) === "object" ? Object.keys(lista[0])[0] : null;
  if (!id || !lista.every((e) => tipo(e) === "object" && typeof e[id] === "number")) return lista;
  return [...lista].sort((p, q) => p[id] - q[id]);
}

// Regla de los listados: por fecha (descendente o ascendente) y, dentro del
// mismo segundo, por id ascendente, como los devolvía SQLite.
function verificarOrden(valor, ruta, errores) {
  if (tipo(valor) === "array") {
    const campoFecha = valor.length > 1 && tipo(valor[0]) === "object" ? ["fecha_hora", "fecha_expedicion"].find((c) => c in valor[0]) : null;
    if (campoFecha) {
      const id = Object.keys(valor[0])[0];
      const signos = new Set();
      for (let i = 1; i < valor.length; i++) {
        const [p, q] = [valor[i - 1], valor[i]];
        if (p[campoFecha] === q[campoFecha]) {
          if (!(p[id] < q[id]) && campoFecha === "fecha_hora") errores.push(`${ruta}: empate de fecha sin ${id} ascendente`);
        } else signos.add(p[campoFecha] < q[campoFecha] ? "asc" : "desc");
      }
      if (signos.size > 1) errores.push(`${ruta}: no está ordenado por ${campoFecha}`);
    }
    valor.forEach((e, i) => verificarOrden(e, `${ruta}[${i}]`, errores));
  } else if (tipo(valor) === "object") {
    for (const [k, v] of Object.entries(valor)) verificarOrden(v, `${ruta}.${k}`, errores);
  }
}

function comparar(x, y, ruta, clave, errores) {
  if (tipo(x) !== tipo(y)) {
    errores.push(`${ruta}: tipo ${tipo(x)} (${JSON.stringify(x)}) vs ${tipo(y)} (${JSON.stringify(y)})`);
    return;
  }
  if (tipo(x) === "array") {
    if (x.length !== y.length) errores.push(`${ruta}: ${x.length} elementos vs ${y.length}`);
    [x, y] = [ordenarPorId(x), ordenarPorId(y)];
    for (let i = 0; i < Math.min(x.length, y.length); i++) comparar(x[i], y[i], `${ruta}[${i}]`, clave, errores);
    return;
  }
  if (tipo(x) === "object") {
    const kx = Object.keys(x);
    const ky = Object.keys(y);
    if (kx.join(",") !== ky.join(",")) {
      const faltan = kx.filter((k) => !ky.includes(k));
      const sobran = ky.filter((k) => !kx.includes(k));
      errores.push(
        faltan.length || sobran.length
          ? `${ruta}: faltan [${faltan}] sobran [${sobran}]`
          : `${ruta}: mismos campos en distinto orden`
      );
    }
    for (const k of kx) if (k in y) comparar(x[k], y[k], `${ruta}.${k}`, k, errores);
    return;
  }
  if (tipo(x) === "string") {
    const nx = normalizarTexto(clave, x, `${ruta} (${a})`, errores);
    const ny = normalizarTexto(clave, y, `${ruta} (${b})`, errores);
    if (nx !== ny) errores.push(`${ruta}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
    return;
  }
  // iat/exp del JWT dependen de la hora de la corrida.
  if ((clave === "iat" || clave === "exp") && Number.isInteger(x) && Number.isInteger(y)) return;
  // El PDF imprime la fecha de expedición y va comprimido: su tamaño varía
  // unos bytes según la hora. Basta con que no esté vacío ("inicio" = "%PDF-").
  if (clave === "pdf_bytes" && x > 0 && y > 0) return;
  if (x !== y) errores.push(`${ruta}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
}

const archivosA = fs.readdirSync(dirA).sort();
const archivosB = fs.readdirSync(dirB).sort();
let fallas = 0;

if (archivosA.join() !== archivosB.join()) {
  console.log(`Las carpetas no tienen los mismos pasos (${archivosA.length} vs ${archivosB.length}).`);
  fallas++;
}

for (const archivo of archivosA.filter((f) => archivosB.includes(f))) {
  const x = JSON.parse(fs.readFileSync(path.join(dirA, archivo), "utf8"));
  const y = JSON.parse(fs.readFileSync(path.join(dirB, archivo), "utf8"));
  const errores = [];
  comparar(x, y, "", null, errores);
  verificarOrden(x.body, `(${a})`, errores);
  verificarOrden(y.body, `(${b})`, errores);
  if (errores.length) {
    fallas++;
    console.log(`✗ ${archivo}`);
    for (const e of errores.slice(0, 15)) console.log(`    ${e}`);
    if (errores.length > 15) console.log(`    ... y ${errores.length - 15} diferencias más`);
  }
}

console.log(`\n${archivosA.length} respuestas comparadas: ${fallas === 0 ? "todas idénticas" : `${fallas} con diferencias`}.`);
process.exitCode = fallas === 0 ? 0 : 1;
