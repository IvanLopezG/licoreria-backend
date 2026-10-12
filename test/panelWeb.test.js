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
const { firmarToken } = require("./apoyo/usuariosSimulados");
const app = require("../src/app");

const PANEL = path.join(__dirname, "..", "public", "panel");
const CATALOGO = path.join(__dirname, "..", "public", "catalogo");
const NUEVAS = ["reportes.html", "alertas.html", "asistente.html"];
const PAGINA_USUARIOS = "usuarios.html"; // solo administrador
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
  for (const archivo of [...NUEVAS, PAGINA_USUARIOS, SCRIPT_NUEVO]) {
    const panel = await obtener(`/panel/${archivo}`);
    assert.strictEqual(panel.status, 200, archivo);
    assert.match(panel.tipo, archivo.endsWith(".js") ? /javascript/ : /text\/html/, archivo);
    const catalogo = await obtener(`/catalogo/${archivo}`);
    assert.strictEqual(catalogo.status, 404, `/catalogo/${archivo}`);
  }
});

test("el catálogo público no referencia ni carga nada de las secciones nuevas", () => {
  const html = fs.readFileSync(path.join(CATALOGO, "index.html"), "utf8");
  for (const prohibido of [...NUEVAS, PAGINA_USUARIOS, SCRIPT_NUEVO, "menu.js", "/api/reportes", "/api/alertas-stock", "/api/chatbot", "/api/usuarios", "Asistente"]) {
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
  for (const archivo of [...NUEVAS, PAGINA_USUARIOS]) {
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
  assert.strictEqual(paginas.length, 11); // 7 que ya existían + Reportes, Alertas, Asistente + Usuarios
  for (const archivo of paginas) {
    const html = fs.readFileSync(path.join(PANEL, archivo), "utf8");
    for (const [href, texto] of [["alertas.html", "Alertas de stock"], ["reportes.html", "Reportes"], ["asistente.html", "Asistente"]]) {
      const enlace = new RegExp(`<a href="${href.replace(".", "\\.")}" class="nav-item solo-gestion( activo)?">[\\s\\S]*?<span>${texto}</span>`);
      assert.match(html, enlace, `${archivo}: falta ${texto}`);
    }
    const activos = [...html.matchAll(/class="nav-item[^"]*\bactivo\b[^"]*"/g)];
    assert.strictEqual(activos.length, 1, `${archivo}: ${activos.length} entradas activas`);
    // Orden igual que la app: Inventario, Alertas, Ventas, Reportes, Asistente, Datos del negocio (y Usuarios, solo web).
    const orden = ["inventario.html", "alertas.html", "ventas.html", "reportes.html", "asistente.html", "negocio.html", "usuarios.html"].map((h) =>
      html.indexOf(`<a href="${h}"`)
    );
    assert.deepStrictEqual([...orden].sort((a, b) => a - b), orden, `${archivo}: orden del menú`);
  }
  // Las nuevas marcan su propia entrada.
  for (const archivo of NUEVAS) {
    assert.match(fs.readFileSync(path.join(PANEL, archivo), "utf8"), new RegExp(`<a href="${archivo.replace(".", "\\.")}" class="nav-item solo-gestion activo">`));
  }
  for (const archivo of paginas) {
    const activo = archivo === PAGINA_USUARIOS ? " activo" : "";
    assert.match(fs.readFileSync(path.join(PANEL, archivo), "utf8"), new RegExp(`<a href="usuarios\\.html" class="nav-item solo-admin${activo}">[\\s\\S]*?<span>Usuarios</span>`), archivo);
  }
});

// DOM mínimo para ejecutar menu.js en Node: solo lo que el script usa.
// Los enlaces del menú salen del HTML real de la página (href y clases).
function enlacesDelMenu(pagina) {
  const html = fs.readFileSync(path.join(PANEL, pagina), "utf8");
  const nav = /<nav class="sidebar-nav">([\s\S]*?)<\/nav>/.exec(html)[1];
  return [...nav.matchAll(/<a href="([^"]+)" class="([^"]+)">/g)].map(([, href, clase]) => ({ href, class: clase }));
}

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
    getAttribute(n) {
      return n in this.atributos ? this.atributos[n] : null;
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
  const enlaces = enlacesDelMenu(ruta.split("/").pop()).map((a) => elemento(a));
  const nav = elemento();
  nav.querySelectorAll = (sel) => {
    const clase = sel.replace(/^a?\./, "");
    return enlaces.filter((e) => !e.removido && clases(e.className).includes(clase));
  };
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
  vm.runInContext(
    `${fs.readFileSync(path.join(PANEL, "menu.js"), "utf8")}\nthis.MenuPanel = MenuPanel; this.ROLES_POR_PAGINA = ROLES_POR_PAGINA; this.puedeVerPagina = puedeVerPagina; this.scrollParaCentrar = scrollParaCentrar;`,
    contexto
  );
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

// Menú por rol (tabla de CLAUDE.md, "Menú del panel web por rol"). Mismo orden en todas las páginas.
const TODAS = ["mesas.html", "pedidos.html", "productos.html", "proveedores.html", "inventario.html", "alertas.html", "ventas.html", "reportes.html", "asistente.html", "negocio.html", "usuarios.html"];
const MENU_ESPERADO = {
  administrador: TODAS, // 11 entradas
  cajero: TODAS.filter((h) => h !== "negocio.html" && h !== "usuarios.html"),
  mesero: ["mesas.html", "pedidos.html"],
};

test("menú por rol: cada rol ve solo sus páginas, en todas las páginas del panel", () => {
  const paginas = fs.readdirSync(PANEL).filter((f) => f.endsWith(".html") && f !== "login.html");
  for (const pagina of paginas) {
    const ruta = `/panel/${pagina}`;
    // El menú de cada página tiene las 10 entradas (más Login) en el mismo orden.
    assert.deepStrictEqual(enlacesDelMenu(pagina).map((e) => e.href), ["login.html", ...TODAS], pagina);
    for (const [rol, esperado] of Object.entries(MENU_ESPERADO)) {
      assert.deepStrictEqual(simularMenu({ rol, ruta }).visibles(), esperado, `${pagina} (${rol})`);
    }
    // Rol desconocido o sesión sin usuario: nada restringido (lo más conservador).
    assert.deepStrictEqual(simularMenu({ rol: "otro", ruta }).visibles(), [], `${pagina} (otro)`);
    // Sin sesión: se conserva "Login" (la página igual pide iniciar sesión).
    assert.deepStrictEqual(simularMenu({ rol: null, token: null, ruta }).visibles(), ["login.html"], `${pagina} (sin sesión)`);
  }
  // La función pura coincide con la tabla esperada.
  const { contexto } = simularMenu({ rol: "cajero" });
  for (const [rol, esperado] of Object.entries(MENU_ESPERADO)) {
    assert.deepStrictEqual(TODAS.filter((h) => contexto.puedeVerPagina(rol, h)), esperado, rol);
  }
  assert.deepStrictEqual(Object.keys(contexto.ROLES_POR_PAGINA).sort(), [...TODAS].sort());
});

test("toda página oculta para algún rol tiene su aviso de permiso si se abre escribiendo la URL", () => {
  const { contexto } = simularMenu({ rol: "cajero" });
  for (const pagina of TODAS) {
    if (["administrador", "cajero", "mesero"].every((rol) => contexto.puedeVerPagina(rol, pagina))) continue;
    const html = fs.readFileSync(path.join(PANEL, pagina), "utf8");
    assert.match(html, /No tienes permiso|Solo el administrador puede editar/, pagina);
    // Con el 403 de la API, o por rol antes de pedir nada (Datos del negocio).
    assert.match(html, /status === 403|!esAdmin\(\)/, pagina);
  }
});

// Endpoint principal de cada página (con el que carga sus datos).
const ENDPOINT_PAGINA = {
  "mesas.html": "/api/mesas",
  "pedidos.html": "/api/pedidos",
  "productos.html": "/api/productos",
  "proveedores.html": "/api/proveedores",
  "inventario.html": "/api/inventario/movimientos",
  "alertas.html": "/api/alertas-stock",
  "ventas.html": "/api/ventas",
  "reportes.html": "/api/reportes?periodo=dia",
  "asistente.html": "/api/chatbot/preguntas",
  "negocio.html": "/api/emisor/resolucion",
  "usuarios.html": "/api/usuarios",
};

test("menú por rol = permisos reales de la API: una entrada visible nunca recibe 403 y una oculta siempre", async () => {
  const { contexto } = simularMenu({ rol: "cajero" });
  assert.deepStrictEqual(Object.keys(ENDPOINT_PAGINA).sort(), Object.keys(contexto.ROLES_POR_PAGINA).sort());
  const servidor = app.listen(0);
  try {
    const base = `http://127.0.0.1:${servidor.address().port}`;
    for (const rol of ["administrador", "cajero", "mesero"]) {
      const token = firmarToken(rol, { usuario_login: `${rol}_menu` });
      for (const [pagina, ruta] of Object.entries(ENDPOINT_PAGINA)) {
        const res = await fetch(base + ruta, { headers: { Authorization: `Bearer ${token}` } });
        await res.arrayBuffer();
        // Sin base de datos un rol permitido llega al controlador (500); con base, 200. Nunca 401/403.
        if (contexto.puedeVerPagina(rol, pagina)) assert.ok(![401, 403].includes(res.status), `${rol} ${ruta}: ${res.status}`);
        else assert.strictEqual(res.status, 403, `${rol} ${ruta}`);
      }
    }
  } finally {
    await new Promise((r) => servidor.close(r));
  }
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
  for (const archivo of [...NUEVAS, PAGINA_USUARIOS]) {
    const script = fs.readFileSync(path.join(PANEL, archivo), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
    // innerHTML solo con texto fijo (aviso sin sesión y encabezado de tabla), nunca con datos.
    for (const linea of script.split("\n").filter((l) => l.includes("innerHTML"))) {
      assert.ok(!/\$\{|\+\s*[a-z]/i.test(linea.split("innerHTML")[1]), `${archivo}: innerHTML con datos: ${linea.trim()}`);
    }
    assert.ok(!/insertAdjacentHTML|outerHTML|document\.write/.test(script), archivo);
  }
  const usuarios = fs.readFileSync(path.join(PANEL, PAGINA_USUARIOS), "utf8");
  assert.match(usuarios, /<input type="password" id="password"/);
  assert.match(usuarios, /<input type="password" id="confirmacion"/);
  assert.ok(!/console\./.test(usuarios), "usuarios.html sin console.*");
  assert.match(usuarios, /celda\(u\.usuario_login/);
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

  // El cajero es un usuario real (consulta real de auth.js); los demás roles, simulados.
  const firmar = (rol) =>
    rol === "cajero" ? jwt.sign({ id_usuario, usuario_login: "cajero_web", rol }, process.env.JWT_SECRET) : firmarToken(rol, { usuario_login: `${rol}_web` });
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

test("barra del menú en celular: la entrada activa queda centrada; en escritorio no se mueve", () => {
  const { contexto } = simularMenu({ rol: "administrador" });
  const centrar = contexto.scrollParaCentrar;
  // Barra de 360 px que mide 1500 px por dentro, sin desplazar; entrada activa al final (x = 1300..1400).
  const base = { barraIzq: 0, barraAncho: 360, scrollActual: 0, scrollAncho: 1500 };
  assert.strictEqual(centrar({ ...base, itemIzq: 1300, itemAncho: 100 }), 1140); // límite: 1500 - 360
  // En medio: centro de la entrada (700 + 50) al centro de la barra (180) → 570.
  assert.strictEqual(centrar({ ...base, itemIzq: 700, itemAncho: 100 }), 570);
  // Al inicio: no baja de 0.
  assert.strictEqual(centrar({ ...base, itemIzq: 10, itemAncho: 80 }), 0);
  // Ya desplazada: la posición en pantalla es relativa al scroll actual.
  assert.strictEqual(centrar({ ...base, scrollActual: 400, itemIzq: 300, itemAncho: 100 }), 570);
  // Escritorio (sin desborde): conserva el scroll actual.
  assert.strictEqual(centrar({ barraIzq: 0, barraAncho: 220, scrollActual: 0, scrollAncho: 220, itemIzq: 0, itemAncho: 200 }), 0);
  // El DOM simulado no tiene getBoundingClientRect ni entrada .activo: centrarActiva no falla.
  assert.doesNotThrow(() => contexto.MenuPanel.centrarActiva());
});
