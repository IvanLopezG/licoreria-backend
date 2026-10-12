// Panel web: secciones Reportes, Alertas de stock y Asistente.
//
// 1) Sin base de datos (siempre corren): los archivos nuevos se sirven solo en
//    /panel, el catálogo público no los referencia ni los carga, ninguna página
//    usa scripts externos, el menú los muestra solo a administrador y cajero
//    (menu.js con un DOM mínimo simulado) y el contador de alertas se consulta
//    una sola vez por sesión de la pestaña.
// 2) Con un Postgres LOCAL desechable y recién creado (igual que reportes.test.js):
//    los endpoints que usan las secciones responden con la forma de siempre.
//      PRUEBA_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres node --test test/panelWeb.test.js
//    Nunca Supabase y nunca el Gemini real (sin GEMINI_API_KEY: modo básico).
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
process.env.JWT_SECRET = "secreto-solo-para-pruebas";
delete process.env.GEMINI_API_KEY;

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const jwt = require("jsonwebtoken");
const app = require("../src/app");

const PANEL = path.join(__dirname, "..", "public", "panel");
const CATALOGO = path.join(__dirname, "..", "public", "catalogo");
const NUEVAS = ["reportes.html", "alertas.html", "asistente.html"];
const SCRIPT_NUEVO = "gestion.js";

let servidor;
let base;
test.before(() => {
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

const obtener = async (ruta, opciones) => {
  const r = await fetch(`${base}${ruta}`, opciones);
  return { status: r.status, tipo: r.headers.get("content-type") || "", texto: await r.text() };
};

// ---------- 1) Archivos y menú (sin base) ----------

test("las páginas y el script nuevos se sirven en /panel y no en /catalogo", async () => {
  for (const archivo of [...NUEVAS, SCRIPT_NUEVO]) {
    const panel = await obtener(`/panel/${archivo}`);
    assert.strictEqual(panel.status, 200, archivo);
    assert.match(panel.tipo, archivo.endsWith(".js") ? /javascript/ : /text\/html/, archivo);
    const catalogo = await obtener(`/catalogo/${archivo}`);
    assert.strictEqual(catalogo.status, 404, `/catalogo/${archivo}`);
  }
});

test("el catálogo público no referencia ni carga nada de las secciones nuevas", () => {
  const html = fs.readFileSync(path.join(CATALOGO, "index.html"), "utf8");
  for (const prohibido of [...NUEVAS, SCRIPT_NUEVO, "menu.js", "/api/reportes", "/api/alertas-stock", "/api/chatbot", "Asistente"]) {
    assert.ok(!html.includes(prohibido), `el catálogo menciona ${prohibido}`);
  }
  // Solo carga api.js del panel (avisos y llamadas), como antes.
  assert.deepStrictEqual([...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]), ["/panel/api.js"]);
});

test("las páginas nuevas cargan solo scripts locales del panel, sin CDNs ni librerías", () => {
  for (const archivo of fs.readdirSync(PANEL).filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(PANEL, archivo), "utf8");
    const fuentes = [...html.matchAll(/<(?:script|link)[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const f of fuentes) {
      assert.ok(!/^(https?:)?\/\//.test(f), `${archivo} carga ${f}`);
      assert.ok(fs.existsSync(path.join(PANEL, f)), `${archivo} referencia ${f}, que no existe`);
    }
  }
  for (const archivo of NUEVAS) {
    const html = fs.readFileSync(path.join(PANEL, archivo), "utf8");
    assert.deepStrictEqual(
      [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]),
      ["menu.js", "api.js", "gestion.js"],
      archivo
    );
    assert.match(html, /<meta name="viewport"/, archivo);
  }
});

test("cada página del panel (menos login) tiene las tres entradas solo-gestion y una sola activa", () => {
  const paginas = fs.readdirSync(PANEL).filter((f) => f.endsWith(".html") && f !== "login.html");
  assert.strictEqual(paginas.length, 10); // 7 que ya existían + 3 nuevas
  for (const archivo of paginas) {
    const html = fs.readFileSync(path.join(PANEL, archivo), "utf8");
    for (const [href, texto] of [["alertas.html", "Alertas de stock"], ["reportes.html", "Reportes"], ["asistente.html", "Asistente"]]) {
      const enlace = new RegExp(`<a href="${href.replace(".", "\\.")}" class="nav-item solo-gestion( activo)?">[\\s\\S]*?<span>${texto}</span>`);
      assert.match(html, enlace, `${archivo}: falta ${texto}`);
    }
    const activos = [...html.matchAll(/class="nav-item[^"]*\bactivo\b[^"]*"/g)];
    assert.strictEqual(activos.length, 1, `${archivo}: ${activos.length} entradas activas`);
    // Orden igual que la app: Inventario, Alertas, Ventas, Reportes, Asistente, Datos del negocio.
    const orden = ["inventario.html", "alertas.html", "ventas.html", "reportes.html", "asistente.html", "negocio.html"].map((h) =>
      html.indexOf(`<a href="${h}"`)
    );
    assert.deepStrictEqual([...orden].sort((a, b) => a - b), orden, `${archivo}: orden del menú`);
  }
  // Las nuevas marcan su propia entrada.
  for (const archivo of NUEVAS) {
    assert.match(fs.readFileSync(path.join(PANEL, archivo), "utf8"), new RegExp(`<a href="${archivo.replace(".", "\\.")}" class="nav-item solo-gestion activo">`));
  }
});

// DOM mínimo para ejecutar menu.js en Node: solo lo que el script usa.
function simularMenu({ rol, token = "eyJ.prueba.firma0123456789abcdef", ruta = "/panel/ventas.html", sesion = {}, respuesta }) {
  const clases = (c) => c.split(/\s+/).filter(Boolean);
  const elemento = (atributos = {}) => ({
    atributos: { ...atributos },
    hijos: [],
    className: atributos.class || "",
    textContent: "",
    removido: false,
    remove() {
      this.removido = true;
    },
    setAttribute(n, v) {
      this.atributos[n] = v;
    },
    appendChild(h) {
      this.hijos.push(h);
      return h;
    },
    addEventListener(tipo, f) {
      this[`on${tipo}`] = f;
    },
    querySelector(sel) {
      return sel === ".nav-contador" ? this.hijos.find((h) => h.className === "nav-contador" && !h.removido) || null : null;
    },
  });
  const enlaces = ["login.html", "ventas.html", "alertas.html", "reportes.html", "asistente.html", "negocio.html"].map((href) =>
    elemento({
      href,
      class: `nav-item${["alertas.html", "reportes.html", "asistente.html"].includes(href) ? " solo-gestion" : ""}${href === "negocio.html" ? " solo-admin" : ""}`,
    })
  );
  const nav = elemento();
  nav.querySelectorAll = (sel) => enlaces.filter((e) => !e.removido && clases(e.className).includes(sel.slice(1)));
  nav.querySelector = (sel) => {
    const href = /a\[href="([^"]+)"\]/.exec(sel)[1];
    return enlaces.find((e) => !e.removido && e.atributos.href === href) || null;
  };
  const almacen = (inicial) => {
    const datos = { ...inicial };
    return {
      datos,
      getItem: (k) => (k in datos ? datos[k] : null),
      setItem: (k, v) => {
        datos[k] = String(v);
      },
      removeItem: (k) => {
        delete datos[k];
      },
    };
  };
  const localStorage = almacen({
    ...(token ? { token } : {}),
    ...(rol ? { usuario: JSON.stringify({ nombre: "Prueba", usuario_login: "prueba", rol }) } : {}),
  });
  const sessionStorage = almacen(sesion);
  const pedidos = [];
  const contexto = {
    document: { querySelector: (sel) => (sel === ".sidebar .sidebar-nav" ? nav : null), createElement: () => elemento() },
    localStorage,
    sessionStorage,
    window: { location: { pathname: ruta, replace: (u) => (contexto.redirigido = u) } },
    fetch: async (url, opciones) => {
      pedidos.push({ url, opciones });
      return respuesta || { ok: true, json: async () => ({ productos: [{ estado: "agotado" }, { estado: "por_agotarse" }, { estado: "ok" }, { estado: "raro" }] }) };
    },
    JSON,
    Number,
    String,
    Array,
  };
  vm.createContext(contexto);
  vm.runInContext(`${fs.readFileSync(path.join(PANEL, "menu.js"), "utf8")}\nthis.MenuPanel = MenuPanel;`, contexto);
  const visibles = () => enlaces.filter((e) => !e.removido).map((e) => e.atributos.href);
  const contador = () => {
    const alertas = enlaces.find((e) => e.atributos.href === "alertas.html");
    const c = alertas.hijos.find((h) => h.className === "nav-contador" && !h.removido);
    return c ? c.textContent : null;
  };
  const salir = nav.hijos.find((h) => h.className === "nav-item nav-salir");
  return { visibles, contador, pedidos, sessionStorage, localStorage, salir, contexto };
}

const esperar = () => new Promise((r) => setImmediate(r));

test("menú: solo administrador y cajero ven Alertas, Reportes y Asistente; solo el administrador ve Datos del negocio", () => {
  assert.deepStrictEqual(simularMenu({ rol: "administrador" }).visibles(), ["ventas.html", "alertas.html", "reportes.html", "asistente.html", "negocio.html"]);
  assert.deepStrictEqual(simularMenu({ rol: "cajero" }).visibles(), ["ventas.html", "alertas.html", "reportes.html", "asistente.html"]);
  assert.deepStrictEqual(simularMenu({ rol: "mesero" }).visibles(), ["ventas.html"]);
  assert.deepStrictEqual(simularMenu({ rol: "otro" }).visibles(), ["ventas.html"]);
  // Sin sesión: se ocultan igual y se conserva "Login".
  assert.deepStrictEqual(simularMenu({ rol: null, token: null }).visibles(), ["login.html", "ventas.html"]);
});

test("contador de alertas: una consulta al entrar al panel, guardada en la pestaña; mesero nunca consulta", async () => {
  const cajero = simularMenu({ rol: "cajero" });
  await esperar();
  await esperar();
  assert.strictEqual(cajero.pedidos.length, 1);
  assert.strictEqual(cajero.pedidos[0].url, "/api/alertas-stock");
  assert.strictEqual(cajero.pedidos[0].opciones.headers.Authorization, "Bearer eyJ.prueba.firma0123456789abcdef");
  assert.strictEqual(cajero.contador(), "2"); // estados desconocidos y "ok" no cuentan

  // Otra página de la misma pestaña: usa lo guardado, sin consultar.
  const siguiente = simularMenu({ rol: "cajero", sesion: cajero.sessionStorage.datos });
  await esperar();
  assert.strictEqual(siguiente.pedidos.length, 0);
  assert.strictEqual(siguiente.contador(), "2");

  // Otra sesión (otro token) no ve el número anterior y consulta de nuevo.
  const otraSesion = simularMenu({ rol: "administrador", token: "eyJ.otra.firmaZZZZZZZZZZZZZZZZ", sesion: cajero.sessionStorage.datos });
  await esperar();
  assert.strictEqual(otraSesion.pedidos.length, 1);

  // La página de alertas consulta por su cuenta (el menú no) y actualiza el contador.
  const alertas = simularMenu({ rol: "cajero", ruta: "/panel/alertas.html" });
  await esperar();
  assert.strictEqual(alertas.pedidos.length, 0);
  alertas.contexto.MenuPanel.actualizarContadorAlertas(150);
  assert.strictEqual(alertas.contador(), "99+");
  alertas.contexto.MenuPanel.actualizarContadorAlertas(0);
  assert.strictEqual(alertas.contador(), null);

  // Mesero: ni consulta ni contador.
  const mesero = simularMenu({ rol: "mesero" });
  await esperar();
  assert.strictEqual(mesero.pedidos.length, 0);

  // Un error (403, sin red) no muestra contador ni rompe el menú.
  const conError = simularMenu({ rol: "cajero", respuesta: { ok: false, status: 403, json: async () => ({}) } });
  await esperar();
  assert.strictEqual(conError.contador(), null);
});

test("cerrar sesión borra el token, el usuario y el contador guardado", async () => {
  const m = simularMenu({ rol: "cajero" });
  await esperar();
  await esperar();
  assert.ok(m.sessionStorage.getItem("contadorAlertas"));
  m.salir.onclick();
  assert.strictEqual(m.localStorage.getItem("token"), null);
  assert.strictEqual(m.localStorage.getItem("usuario"), null);
  assert.strictEqual(m.sessionStorage.getItem("contadorAlertas"), null);
  assert.strictEqual(m.contexto.redirigido, "login.html");
});

test("las respuestas de la API se insertan como texto, nunca como HTML", () => {
  for (const archivo of NUEVAS) {
    const script = fs.readFileSync(path.join(PANEL, archivo), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
    // innerHTML solo con texto fijo (aviso sin sesión y encabezado de tabla), nunca con datos.
    for (const linea of script.split("\n").filter((l) => l.includes("innerHTML"))) {
      assert.ok(!/\$\{|\+\s*[a-z]/i.test(linea.split("innerHTML")[1]), `${archivo}: innerHTML con datos: ${linea.trim()}`);
    }
    assert.ok(!/insertAdjacentHTML|outerHTML|document\.write/.test(script), archivo);
  }
  const asistente = fs.readFileSync(path.join(PANEL, "asistente.html"), "utf8");
  assert.match(asistente, /caja\.textContent = m\.texto;/);
  assert.match(asistente, /maxlength="500"/);
});

// ---------- 2) Endpoints con la base local ----------

test("integración: los endpoints que usan las secciones responden con la forma de siempre", { skip: !BASE_LOCAL && "sin PRUEBA_DATABASE_URL local" }, async (t) => {
  const db = require("../src/db/db");
  await db.inicializarEsquema();
  const { n } = await db.uno("SELECT COUNT(*) AS n FROM productos");
  if (n > 0) {
    await db.pool.end();
    t.skip("la base ya tiene productos: se necesita una base recién creada");
    return;
  }
  t.after(() => db.pool.end());
  const { id_usuario } = await db.uno(
    "INSERT INTO usuarios (nombre, usuario_login, password_hash, rol) VALUES ('Cajero web', 'cajero_web', 'x', 'cajero') RETURNING id_usuario"
  );
  const { id_categoria } = await db.uno("INSERT INTO categorias (nombre) VALUES ('Licores') RETURNING id_categoria");
  const { id_producto } = await db.uno(
    `INSERT INTO productos (id_categoria, nombre, unidad_medida, precio, stock_actual, umbral_alerta)
     VALUES ($1, '<img src=x onerror=alert(1)>', 'botella', 10000, 0, 5) RETURNING id_producto`,
    [id_categoria]
  );
  const { id_venta } = await db.uno("INSERT INTO ventas (tipo, id_usuario, total) VALUES ('mostrador', $1, 20000) RETURNING id_venta", [id_usuario]);
  await db.ejecutar("INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario) VALUES ($1, $2, 2, 10000)", [id_venta, id_producto]);

  const firmar = (rol) => jwt.sign({ id_usuario, usuario_login: `${rol}_web`, rol }, process.env.JWT_SECRET);
  const pedir = async (ruta, rol = "cajero", opciones = {}) => {
    const r = await fetch(`${base}${ruta}`, {
      ...opciones,
      headers: { "Content-Type": "application/json", ...(rol ? { Authorization: `Bearer ${firmar(rol)}` } : {}) },
    });
    return { status: r.status, body: await r.json() };
  };

  const reporte = await pedir("/api/reportes?periodo=dia");
  assert.strictEqual(reporte.status, 200);
  assert.deepStrictEqual(Object.keys(reporte.body).sort(), [
    "fecha_referencia", "movimientos_inventario", "numero_ventas", "periodo", "productos_menos_vendidos", "rango",
    "ticket_promedio", "top_productos", "total_vendido", "ventas_por_dia",
  ]);
  assert.strictEqual(reporte.body.total_vendido, 20000);
  // El nombre llega tal cual (el panel lo pinta con textContent).
  assert.strictEqual(reporte.body.top_productos[0].nombre, "<img src=x onerror=alert(1)>");

  const alertas = await pedir("/api/alertas-stock");
  assert.strictEqual(alertas.status, 200);
  assert.deepStrictEqual(Object.keys(alertas.body).sort(), ["parametros", "productos", "resumen"]);
  assert.strictEqual(alertas.body.productos[0].estado, "agotado");

  const preguntas = await pedir("/api/chatbot/preguntas");
  assert.strictEqual(preguntas.status, 200);
  assert.strictEqual(preguntas.body.preguntas.length, 5);
  const libre = await pedir("/api/chatbot", "administrador", { method: "POST", body: JSON.stringify({ mensaje: "hola" }) });
  assert.deepStrictEqual(Object.keys(libre.body).sort(), ["origen", "respuesta"]);
  assert.strictEqual(libre.body.origen, "basico");

  for (const ruta of ["/api/reportes?periodo=dia", "/api/alertas-stock", "/api/chatbot/preguntas"]) {
    assert.strictEqual((await pedir(ruta, "mesero")).status, 403, ruta);
    assert.strictEqual((await pedir(ruta, null)).status, 401, ruta);
  }
});
