const db = require("../db/db");
const resolucionModel = require("../models/resolucionModel");
const { hoyColombia } = require("../utils/fechaColombia");

// Resolución de numeración de facturas (solo administrador).
//
// Las facturas no copian los datos de la resolución (número, fecha, rango): el
// PDF los lee de secuencias_factura. Por eso una resolución que ya emitió
// facturas no se edita (cambiaría el historial): se registra una nueva y la
// anterior queda como histórica. La clave técnica nunca sale de aquí: solo se
// informa si está configurada.

const PREFIJO = /^[A-Z0-9]{1,4}$/;
const NUMERO_RESOLUCION = /^\d{1,20}$/;
const MAX_CLAVE_TECNICA = 128;
// Umbrales de aviso del panel.
const PORCENTAJE_POR_AGOTARSE = 0.1;
const DIAS_POR_VENCER = 30;

function errorConEstado(mensaje, status = 400) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

// "AAAA-MM-DD" válida (rechaza 2026-02-30); null si no lo es.
function fecha(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor ?? "").trim());
  if (!m) return null;
  const [anio, mes, dia] = m.slice(1).map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? m[0] : null;
}

function entero(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return null;
  const n = Number(valor);
  return Number.isInteger(n) ? n : NaN;
}

// Fecha de hoy con el mismo criterio que usa la emisión de facturas
// (facturaModel.tomarSiguienteNumero): la fecha de Colombia.
const hoy = () => hoyColombia();
const diasEntre = (desde, hasta) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000);

// Valida el cuerpo. "base" da los valores de los campos que no llegan (edición
// parcial); en una resolución nueva no hay base. clave_tecnica: undefined si no
// se escribió (se conserva la guardada al editar).
function validar(body, base = {}) {
  const valor = (campo) => (body[campo] === undefined ? base[campo] : body[campo]);

  const prefijoTexto = String(valor("prefijo") ?? "").trim().toUpperCase();
  const prefijo = prefijoTexto === "" ? null : prefijoTexto;
  if (prefijo !== null && !PREFIJO.test(prefijo)) {
    throw errorConEstado("El prefijo debe tener de 1 a 4 letras o números, sin espacios ni símbolos (o dejarse vacío).");
  }

  const resolucion_numero = String(valor("resolucion_numero") ?? "").trim();
  if (!NUMERO_RESOLUCION.test(resolucion_numero)) {
    throw errorConEstado("El número de resolución es obligatorio y debe contener solo dígitos.");
  }
  const resolucion_fecha = fecha(valor("resolucion_fecha"));
  if (!resolucion_fecha) throw errorConEstado("La fecha de la resolución es obligatoria y debe ser una fecha válida (AAAA-MM-DD).");

  const rango_desde = entero(valor("rango_desde"));
  const rango_hasta = entero(valor("rango_hasta"));
  if (!Number.isInteger(rango_desde) || rango_desde < 1 || !Number.isInteger(rango_hasta) || rango_hasta < 1) {
    throw errorConEstado("El rango (desde y hasta) es obligatorio y debe ser de números enteros mayores a 0.");
  }
  if (rango_desde > rango_hasta) {
    throw errorConEstado("El inicio del rango no puede ser mayor que el final.");
  }

  const vigencia_desde = fecha(valor("vigencia_desde"));
  const vigencia_hasta = fecha(valor("vigencia_hasta"));
  if (!vigencia_desde || !vigencia_hasta) {
    throw errorConEstado("Las fechas de vigencia (desde y hasta) son obligatorias y deben ser fechas válidas (AAAA-MM-DD).");
  }
  if (vigencia_hasta <= vigencia_desde) {
    throw errorConEstado("La vigencia debe terminar después de la fecha en que empieza.");
  }
  // Una resolución ya vencida bloquearía toda venta al activarse (la emisión de
  // facturas rechaza resoluciones vencidas): se rechaza al guardarla.
  if (vigencia_hasta < hoy()) {
    throw errorConEstado(`La vigencia terminó el ${vigencia_hasta}: con una resolución vencida no se podría facturar.`);
  }

  // Solo se toma si el administrador la escribió; vacía = se conserva la guardada.
  let clave_tecnica;
  const claveTexto = body.clave_tecnica === undefined || body.clave_tecnica === null ? "" : String(body.clave_tecnica).trim();
  if (claveTexto !== "") {
    if (claveTexto.length > MAX_CLAVE_TECNICA || /\s/.test(claveTexto)) {
      throw errorConEstado(`La clave técnica no puede tener espacios ni más de ${MAX_CLAVE_TECNICA} caracteres.`);
    }
    clave_tecnica = claveTexto;
  }

  return {
    prefijo, resolucion_numero, resolucion_fecha, rango_desde, rango_hasta, vigencia_desde, vigencia_hasta, clave_tecnica,
    // La numeración de la resolución empieza en rango_desde (ver tomarSiguienteNumero).
    numero_actual: rango_desde - 1,
  };
}

// La numeración no se reusa ni retrocede: el rango debe empezar después del
// último número emitido con el mismo prefijo, en cualquier resolución.
async function verificarNumeracion(datos, cx) {
  const ultimo = await resolucionModel.ultimoNumeroConPrefijo(datos.prefijo, cx);
  if (datos.rango_desde <= ultimo) {
    const conPrefijo = datos.prefijo ? `con el prefijo "${datos.prefijo}"` : "sin prefijo";
    throw errorConEstado(
      `La numeración no se puede reusar ni retroceder: el último número emitido ${conPrefijo} es ${ultimo}, ` +
        `así que el rango debe empezar en ${ultimo + 1} o después.`,
      409
    );
  }
}

// Nombres de los campos que cambian (para la bitácora; nunca los valores).
function camposCambiados(datos, actual) {
  const campos = ["prefijo", "resolucion_numero", "resolucion_fecha", "rango_desde", "rango_hasta", "vigencia_desde", "vigencia_hasta"]
    .filter((c) => String(datos[c] ?? "") !== String(actual[c] ?? ""));
  if (datos.clave_tecnica !== undefined) campos.push("clave_tecnica");
  return campos;
}

function alertasDe(r) {
  const alertas = [];
  if (!r.resolucion_numero) {
    alertas.push({ nivel: "amarilla", mensaje: "No hay resolución de la DIAN registrada: se usa la numeración interna." });
    return alertas;
  }
  if (r.numeros_restantes === 0) alertas.push({ nivel: "roja", mensaje: "Se agotó el rango de numeración: no se pueden emitir facturas." });
  else if (r.numeros_restantes !== null && r.numeros_restantes < r.total_rango * PORCENTAJE_POR_AGOTARSE) {
    alertas.push({ nivel: "amarilla", mensaje: `Quedan ${r.numeros_restantes} números (menos del 10 % del rango).` });
  }
  if (r.dias_para_vencer !== null) {
    if (r.dias_para_vencer < 0) alertas.push({ nivel: "roja", mensaje: `La resolución venció el ${r.vigencia_hasta}: no se pueden emitir facturas.` });
    else if (r.dias_para_vencer < DIAS_POR_VENCER) {
      alertas.push({ nivel: "amarilla", mensaje: `La resolución vence en ${r.dias_para_vencer} días (${r.vigencia_hasta}).` });
    }
  }
  if (!r.clave_tecnica_configurada) {
    alertas.push({ nivel: "amarilla", mensaje: "Falta la clave técnica (necesaria para la factura electrónica en producción)." });
  }
  return alertas;
}

// Resumen para la API: sin clave técnica, con restantes, vigencia y avisos.
function resumen(s, facturas_emitidas) {
  const siguiente_numero = Math.max(s.numero_actual + 1, s.rango_desde);
  const r = {
    id_secuencia: s.id_secuencia,
    prefijo: s.prefijo,
    resolucion_numero: s.resolucion_numero,
    resolucion_fecha: s.resolucion_fecha,
    rango_desde: s.rango_desde,
    rango_hasta: s.rango_hasta,
    // Último número emitido; null si la resolución aún no emitió ninguno.
    consecutivo_actual: s.numero_actual >= s.rango_desde ? s.numero_actual : null,
    siguiente_numero,
    total_rango: s.rango_hasta === null ? null : s.rango_hasta - s.rango_desde + 1,
    numeros_restantes: s.rango_hasta === null ? null : Math.max(0, s.rango_hasta - siguiente_numero + 1),
    vigencia_desde: s.vigencia_desde,
    vigencia_hasta: s.vigencia_hasta,
    dias_para_vencer: s.vigencia_hasta ? diasEntre(hoy(), s.vigencia_hasta) : null,
    clave_tecnica_configurada: s.clave_tecnica_configurada === true,
    activa: s.activa === 1,
    fecha_registro: s.fecha_registro,
    facturas_emitidas,
    // Una resolución con facturas no se edita: sus datos salen en esas facturas.
    editable: facturas_emitidas === 0,
  };
  return { ...r, alertas: alertasDe(r) };
}

async function obtener() {
  const activa = await resolucionModel.activa();
  if (!activa) throw errorConEstado("No hay una resolución de numeración activa.", 404);
  const historicas = await resolucionModel.historicas();
  return {
    activa: resumen(activa, await resolucionModel.contarFacturas(activa.id_secuencia)),
    historicas: await Promise.all(historicas.map(async (h) => resumen(h, await resolucionModel.contarFacturas(h.id_secuencia)))),
  };
}

// Edita la resolución activa, solo si todavía no emitió facturas.
async function actualizar(body = {}) {
  const resultado = await db.conTransaccion(async (cx) => {
    const actual = await resolucionModel.activaParaActualizar(cx);
    if (!actual) throw errorConEstado("No hay una resolución de numeración activa.", 404);
    const facturas = await resolucionModel.contarFacturas(actual.id_secuencia, cx);
    if (facturas > 0) {
      throw errorConEstado(
        `La resolución activa ya emitió ${facturas} factura(s) y no se puede modificar, porque sus datos salen en ` +
          "esas facturas. Registra una resolución nueva: la actual quedará como histórica.",
        409
      );
    }
    const datos = validar(body, actual);
    await verificarNumeracion(datos, cx);
    await resolucionModel.actualizar(actual.id_secuencia, datos, cx);
    return { id_secuencia: actual.id_secuencia, campos: camposCambiados(datos, actual) };
  });
  return { ...(await obtener()), auditoria: resultado };
}

// Registra una resolución nueva: queda activa y la anterior pasa a histórica.
async function registrar(body = {}) {
  const resultado = await db.conTransaccion(async (cx) => {
    // Bloquea la activa: una factura en curso termina antes del cambio (o después, con la nueva).
    await resolucionModel.activaParaActualizar(cx);
    const datos = validar(body);
    await verificarNumeracion(datos, cx);
    const id_secuencia = await resolucionModel.registrar(datos, cx);
    return { id_secuencia, campos: camposCambiados(datos, {}) };
  });
  return { ...(await obtener()), auditoria: resultado };
}

module.exports = { obtener, actualizar, registrar, validar };
