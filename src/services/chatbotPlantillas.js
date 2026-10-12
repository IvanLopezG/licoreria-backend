// Textos del chatbot armados directamente con los datos de reportes y alertas
// (modo básico, sin IA), y formatos que también recibe Gemini ya listos para
// que no tenga que formatear cifras por su cuenta.

const formatoPesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

// "$ 425.000", "$ 50.666,67" (espacio normal en vez del de no separación).
const pesos = (valor) => formatoPesos.format(Number(valor) || 0).replace(/\s/g, " ");
const numero = (valor) => formatoNumero.format(Number(valor) || 0);
const unidades = (valor) => `${numero(valor)} ${Number(valor) === 1 ? "unidad" : "unidades"}`;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const partes = (fecha) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  return { dia: d.getUTCDate(), mes: d.getUTCMonth(), anio: d.getUTCFullYear(), semana: d.getUTCDay() };
};

// "domingo 11 de octubre"
function textoDia(fecha) {
  const p = partes(fecha);
  return `${DIAS[p.semana]} ${p.dia} de ${MESES[p.mes]}`;
}

// "del lunes 5 al domingo 11 de octubre", "del lunes 28 de septiembre al domingo 4 de octubre"
function textoSemana(desde, hasta) {
  const a = partes(desde);
  const b = partes(hasta);
  const inicio = a.mes === b.mes ? `${DIAS[a.semana]} ${a.dia}` : textoDia(desde);
  return `del ${inicio} al ${textoDia(hasta)}`;
}

// "octubre de 2026"
function textoMes(fecha) {
  const p = partes(fecha);
  return `${MESES[p.mes]} de ${p.anio}`;
}

// "A", "A y B", "A, B y C"
function enumerar(lista) {
  if (lista.length <= 1) return lista.join("");
  return `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}`;
}

const ESTADOS = { agotado: "agotado", bajo_minimo: "bajo el mínimo", por_agotarse: "por agotarse" };

function ventasHoy(reporte) {
  const cuando = `Hoy (${textoDia(reporte.rango.desde)})`;
  if (!reporte.numero_ventas) return `${cuando} todavía no hay ventas registradas.`;
  const top = reporte.top_productos.slice(0, 3).map((p) => `${p.nombre} (${unidades(p.unidades)})`);
  return (
    `${cuando} se vendieron ${pesos(reporte.total_vendido)} en ${reporte.numero_ventas} ` +
    `${reporte.numero_ventas === 1 ? "venta" : "ventas"}, con un ticket promedio de ${pesos(reporte.ticket_promedio)}.` +
    (top.length ? ` Lo más vendido: ${enumerar(top)}.` : "")
  );
}

function ventasSemana(reporte) {
  const cuando = `Esta semana (${textoSemana(reporte.rango.desde, reporte.rango.hasta)})`;
  if (!reporte.numero_ventas) return `${cuando} todavía no hay ventas registradas.`;
  // Mejor día: el de mayor total (empate: el primero).
  const mejor = reporte.ventas_por_dia.reduce((m, d) => (d.total > m.total ? d : m), reporte.ventas_por_dia[0]);
  return (
    `${cuando} van ${pesos(reporte.total_vendido)} en ${reporte.numero_ventas} ` +
    `${reporte.numero_ventas === 1 ? "venta" : "ventas"}, con un ticket promedio de ${pesos(reporte.ticket_promedio)}.` +
    (mejor && mejor.total > 0 ? ` El mejor día fue el ${textoDia(mejor.fecha)}, con ${pesos(mejor.total)}.` : "")
  );
}

function masVendidosMes(reporte) {
  const mes = textoMes(reporte.rango.desde);
  if (!reporte.numero_ventas || reporte.top_productos.length === 0) return `En ${mes} todavía no hay ventas registradas.`;
  const lineas = reporte.top_productos
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${p.nombre}: ${unidades(p.unidades)} (${pesos(p.total)})`);
  return `Los más vendidos de ${mes}:\n${lineas.join("\n")}`;
}

const MAXIMO_LISTA = 15;

function reabastecer(alertas) {
  if (alertas.productos.length === 0) return "Todo el stock está en orden: no hay nada que reabastecer por ahora.";
  const lineas = alertas.productos.slice(0, MAXIMO_LISTA).map((p) => {
    const accion = p.cantidad_sugerida > 0 ? `pedir ${numero(p.cantidad_sugerida)}` : "sin cantidad sugerida (pocas ventas recientes)";
    return `• ${p.nombre} (${ESTADOS[p.estado] || p.estado}, stock ${numero(p.stock_actual)}): ${accion}`;
  });
  const resto = alertas.productos.length - MAXIMO_LISTA;
  if (resto > 0) lineas.push(`… y ${resto} más (ver Alertas de stock).`);
  const ventana = alertas.parametros && alertas.parametros.ventana_dias;
  return `Te sugiero reabastecer${ventana ? ` (según las ventas de los últimos ${ventana} días)` : ""}:\n${lineas.join("\n")}`;
}

function agotados(alertas) {
  const nombres = alertas.productos.filter((p) => p.estado === "agotado").map((p) => p.nombre);
  if (nombres.length === 0) return "No hay productos agotados.";
  if (nombres.length === 1) return `Hay 1 producto agotado: ${nombres[0]}.`;
  const mostrados = nombres.slice(0, MAXIMO_LISTA);
  const resto = nombres.length - mostrados.length;
  return (
    `Hay ${nombres.length} productos agotados: ${resto > 0 ? mostrados.join(", ") : enumerar(mostrados)}` +
    (resto > 0 ? ` y ${resto} más (ver Alertas de stock).` : ".")
  );
}

module.exports = { pesos, numero, textoDia, textoSemana, textoMes, enumerar, ventasHoy, ventasSemana, masVendidosMes, reabastecer, agotados };
