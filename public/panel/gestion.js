// Funciones puras de las secciones Reportes, Alertas de stock y Asistente del
// panel interno: fechas de Colombia y periodos, textos legibles, formato de
// pesos, serie de la gráfica, agrupación de alertas y reglas del chat. Sin DOM
// ni red: el panel lo carga con <script> y las pruebas con require (igual que
// csv.js). Solo lo cargan páginas del panel interno, nunca el catálogo.
const Gestion = (() => {
  const PERIODOS = ["dia", "semana", "mes", "anio"];
  const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const MESES_LARGOS = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  // ---------- Fechas (calendario, "AAAA-MM-DD") ----------

  const dos = (n) => String(n).padStart(2, "0");
  const aTexto = (d) => `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;

  // Date en UTC a medianoche, o null si no es una fecha real (2026-02-30 → null).
  function leerFecha(valor) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor ?? ""));
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return aTexto(d) === valor ? d : null;
  }

  // Hoy en Colombia (UTC-5 todo el año, igual que el backend).
  function hoyColombia(ahora = new Date()) {
    return new Date(ahora.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function sumarDias(fecha, n) {
    const d = leerFecha(fecha);
    d.setUTCDate(d.getUTCDate() + n);
    return aTexto(d);
  }

  // Mes o año sumado; un 31 que cae en un mes más corto queda en su último día.
  function sumarMeses(fecha, n) {
    const d = leerFecha(fecha);
    const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
    const anio = Math.floor(total / 12);
    const mes = total - anio * 12;
    const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    return aTexto(new Date(Date.UTC(anio, mes, Math.min(d.getUTCDate(), ultimo))));
  }

  // Mismo rango que utils/periodoReporte.js: semana de lunes a domingo.
  function rangoPeriodo(periodo, fecha) {
    const d = leerFecha(fecha);
    if (!d || !PERIODOS.includes(periodo)) return null;
    const anio = d.getUTCFullYear();
    const mes = d.getUTCMonth();
    if (periodo === "dia") return { desde: fecha, hasta: fecha };
    if (periodo === "semana") {
      const desde = sumarDias(fecha, -((d.getUTCDay() + 6) % 7));
      return { desde, hasta: sumarDias(desde, 6) };
    }
    if (periodo === "mes") {
      return { desde: aTexto(new Date(Date.UTC(anio, mes, 1))), hasta: aTexto(new Date(Date.UTC(anio, mes + 1, 0))) };
    }
    return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
  }

  function moverPeriodo(periodo, fecha, pasos) {
    if (periodo === "dia") return sumarDias(fecha, pasos);
    if (periodo === "semana") return sumarDias(fecha, 7 * pasos);
    if (periodo === "mes") return sumarMeses(fecha, pasos);
    return sumarMeses(fecha, 12 * pasos);
  }

  // Fecha del periodo siguiente o null si ese periodo empieza después de hoy.
  // Si el siguiente contiene hoy, la fecha no pasa de hoy.
  function periodoSiguiente(periodo, fecha, hoy) {
    const siguiente = moverPeriodo(periodo, fecha, 1);
    if (rangoPeriodo(periodo, siguiente).desde > hoy) return null;
    return siguiente > hoy ? hoy : siguiente;
  }

  // Una fecha futura (o inválida) se lleva a hoy.
  function fechaPermitida(fecha, hoy) {
    return leerFecha(fecha) && fecha <= hoy ? fecha : hoy;
  }

  const partes = (fecha) => {
    const d = leerFecha(fecha);
    return { anio: d.getUTCFullYear(), mes: d.getUTCMonth(), dia: d.getUTCDate(), semana: d.getUTCDay() };
  };

  // "Dom 11 oct 2026"
  function textoDia(fecha) {
    const p = partes(fecha);
    return `${DIAS[p.semana]} ${p.dia} ${MESES[p.mes]} ${p.anio}`;
  }

  // "Dom 11 oct 2026", "Lun 5 – Dom 11 oct 2026", "Lun 28 sep – Dom 4 oct 2026",
  // "Lun 29 dic 2025 – Dom 4 ene 2026", "Octubre 2026" o "2026" (igual que la app).
  function textoRango(periodo, desde, hasta) {
    if (!leerFecha(desde) || !leerFecha(hasta)) return "";
    if (desde === hasta) return textoDia(desde);
    const a = partes(desde);
    const b = partes(hasta);
    const mesCompleto = rangoPeriodo("mes", desde);
    if (periodo === "anio" && desde === `${a.anio}-01-01` && hasta === `${a.anio}-12-31`) return String(a.anio);
    if (periodo === "mes" && mesCompleto.desde === desde && mesCompleto.hasta === hasta) {
      return `${MESES_LARGOS[a.mes]} ${a.anio}`;
    }
    if (a.anio !== b.anio) return `${textoDia(desde)} – ${textoDia(hasta)}`;
    if (a.mes !== b.mes) return `${DIAS[a.semana]} ${a.dia} ${MESES[a.mes]} – ${textoDia(hasta)}`;
    return `${DIAS[a.semana]} ${a.dia} – ${textoDia(hasta)}`;
  }

  // ---------- Números ----------

  // "1.234.567" o "2,5" (punto de miles, coma decimal; máximo 2 decimales).
  function formatoNumero(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return "0";
    const signo = n < 0 ? "-" : "";
    const centesimos = Math.round(Math.abs(n) * 100);
    const entero = String(Math.floor(centesimos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const resto = centesimos % 100;
    const decimales = resto === 0 ? "" : `,${dos(resto).replace(/0$/, "")}`;
    return `${signo}${entero}${decimales}`;
  }

  // Pesos colombianos: "$ 152.000"; con centavos solo si los hay: "$ 50.666,67".
  function formatoPesos(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return "$ 0";
    const signo = n < 0 ? "-" : "";
    const centesimos = Math.round(Math.abs(n) * 100);
    const entero = String(Math.floor(centesimos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const resto = centesimos % 100;
    return `${signo}$ ${entero}${resto === 0 ? "" : `,${dos(resto)}`}`;
  }

  // ---------- Gráfica ----------

  // Un punto por día; en el año, los días se suman por mes (365 barras no se
  // leen). Días sin fecha válida se ignoran; vacío → serie vacía.
  function serieGrafica(periodo, ventasPorDia) {
    const dias = (Array.isArray(ventasPorDia) ? ventasPorDia : [])
      .filter((v) => v && leerFecha(String(v.fecha ?? "").slice(0, 10)))
      .map((v) => ({ fecha: String(v.fecha).slice(0, 10), total: Number(v.total) || 0 }))
      .sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0));
    if (periodo === "anio") {
      const porMes = new Map();
      for (const d of dias) {
        const clave = d.fecha.slice(0, 7);
        porMes.set(clave, (porMes.get(clave) || 0) + d.total);
      }
      return [...porMes].map(([clave, total]) => {
        const mes = Number(clave.slice(5, 7)) - 1;
        return { etiqueta: MESES[mes], titulo: `${MESES_LARGOS[mes]} ${clave.slice(0, 4)}`, total };
      });
    }
    return dias.map((d) => {
      const p = partes(d.fecha);
      return { etiqueta: periodo === "semana" ? DIAS[p.semana] : String(p.dia), titulo: textoDia(d.fecha), total: d.total };
    });
  }

  // Barras dentro de un área de ancho × alto: [{x, y, ancho, alto}]. Un total
  // positivo pequeño se ve al menos con 2 px; todo en cero → barras de alto 0.
  function geometriaBarras(serie, ancho, alto) {
    if (!serie.length) return [];
    const maximo = Math.max(...serie.map((p) => p.total));
    const paso = ancho / serie.length;
    const separacion = Math.min(paso * 0.2, 8);
    return serie.map((p, i) => {
      const h = maximo > 0 && p.total > 0 ? Math.max((alto * p.total) / maximo, 2) : 0;
      return { x: i * paso + separacion / 2, y: alto - h, ancho: Math.max(paso - separacion, 1), alto: h };
    });
  }

  // ---------- Alertas de stock ----------

  const ESTADOS_ALERTA = [
    { estado: "agotado", titulo: "Agotado", clase: "badge-agotado" },
    { estado: "bajo_minimo", titulo: "Bajo mínimo", clase: "badge-alerta" },
    { estado: "por_agotarse", titulo: "Por agotarse", clase: "badge-nuevo" },
  ];

  // Grupos en orden de urgencia, sin los vacíos; dentro de cada uno se respeta
  // el orden del backend. Un estado desconocido (u "ok") se ignora.
  function agruparAlertas(productos) {
    const lista = Array.isArray(productos) ? productos : [];
    return ESTADOS_ALERTA.map((e) => ({ ...e, productos: lista.filter((p) => p && p.estado === e.estado) })).filter(
      (g) => g.productos.length > 0
    );
  }

  const contarAlertas = (productos) => agruparAlertas(productos).reduce((s, g) => s + g.productos.length, 0);

  // "4,5 días", "1 día"; sin ventas (null) → "—".
  function textoCobertura(dias) {
    if (dias === null || dias === undefined || !Number.isFinite(Number(dias))) return "—";
    return `${formatoNumero(dias)} ${Number(dias) === 1 ? "día" : "días"}`;
  }

  const SIN_VENTAS_RECIENTES = "Sin ventas recientes: no se calcula cobertura; se sugiere reponer hasta el doble del mínimo.";
  const sinVentasRecientes = (p) => p.dias_cobertura === null || p.dias_cobertura === undefined;

  // ---------- Asistente ----------

  const MAXIMO_MENSAJE = 500;

  // Caracteres como los cuenta el backend (puntos de código, no unidades UTF-16).
  const contarCaracteres = (texto) => [...String(texto ?? "")].length;
  const limitarMensaje = (texto) => [...String(texto ?? "")].slice(0, MAXIMO_MENSAJE).join("");

  // Solo "ia" se muestra como IA; cualquier otro valor (basico, vacío, desconocido) es "Rápida".
  const etiquetaOrigen = (origen) => (origen === "ia" ? "IA" : "Rápida");

  // Qué hacer con un error al enviar: { texto, reintentable, bloquear, irAlLogin }.
  // status 0 = sin respuesta; tiempoAgotado = venció la espera de 150 s.
  function errorAsistente({ status, mensaje, tiempoAgotado }) {
    if (status === 401) return { texto: "Tu sesión expiró. Vuelve a iniciar sesión.", reintentable: false, bloquear: false, irAlLogin: true };
    if (status === 403) return { texto: "No tienes permiso para usar el asistente", reintentable: false, bloquear: true, irAlLogin: false };
    if (status === 429) return { texto: "Espera un momento antes de enviar otro mensaje", reintentable: true, bloquear: false, irAlLogin: false };
    if (status === 400) return { texto: mensaje || "El mensaje no es válido.", reintentable: false, bloquear: false, irAlLogin: false };
    if (tiempoAgotado) {
      return {
        texto: "El asistente tardó demasiado en responder. El servidor puede estar despertando; intenta de nuevo en un momento.",
        reintentable: true, bloquear: false, irAlLogin: false,
      };
    }
    return { texto: mensaje || "No se pudo obtener la respuesta. Intenta de nuevo.", reintentable: true, bloquear: false, irAlLogin: false };
  }

  // ---------- Usuarios ----------

  // "AAAA-MM-DD HH:MM:SS" guardado en UTC (como sale de la API) → "AAAA-MM-DD
  // HH:MM" en hora de Colombia (UTC-5 fijo, igual que hoyColombia). "—" si no
  // es una fecha.
  function fechaHoraColombia(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(texto || ""));
    if (!m) return "—";
    const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    if (Number.isNaN(utc)) return "—";
    const co = new Date(utc - 5 * 3600 * 1000);
    const dos = (n) => String(n).padStart(2, "0");
    return `${co.getUTCFullYear()}-${dos(co.getUTCMonth() + 1)}-${dos(co.getUTCDate())} ${dos(co.getUTCHours())}:${dos(co.getUTCMinutes())}`;
  }

  const ROLES_USUARIO = { administrador: "Administrador", cajero: "Cajero", mesero: "Mesero" };
  const MINIMO_CONTRASENA = 8;

  // Revisión previa del formulario (el backend es la autoridad y repite todo).
  // modo "crear": todo obligatorio; "editar": la contraseña es opcional.
  // Devuelve el texto del problema o null.
  function errorFormularioUsuario({ modo, nombre, usuario_login, rol, password, confirmacion }) {
    if (!String(nombre || "").trim()) return "Escribe el nombre.";
    if (modo === "crear" && !String(usuario_login || "").trim()) return "Escribe el usuario.";
    if (!(rol in ROLES_USUARIO)) return "Elige un rol.";
    const clave = String(password || "");
    if (modo === "crear" || clave || confirmacion) {
      if ([...clave].length < MINIMO_CONTRASENA) return `La contraseña debe tener al menos ${MINIMO_CONTRASENA} caracteres.`;
      if (clave !== String(confirmacion || "")) return "Las contraseñas no coinciden.";
    }
    return null;
  }

  return {
    fechaHoraColombia, ROLES_USUARIO, errorFormularioUsuario,
    PERIODOS, MAXIMO_MENSAJE, ESTADOS_ALERTA, SIN_VENTAS_RECIENTES,
    leerFecha, hoyColombia, sumarDias, sumarMeses, rangoPeriodo, moverPeriodo, periodoSiguiente, fechaPermitida,
    textoDia, textoRango, formatoNumero, formatoPesos, serieGrafica, geometriaBarras,
    agruparAlertas, contarAlertas, textoCobertura, sinVentasRecientes,
    contarCaracteres, limitarMensaje, etiquetaOrigen, errorAsistente,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Gestion;
