// Menú lateral del panel (lo cargan todas las páginas menos el login):
// - Cada rol ve solo las páginas cuyo endpoint principal le responde 200
//   (ROLES_POR_PAGINA, igual que requireRole en src/routes/*.routes.js; las
//   pruebas los comparan). Un rol desconocido no ve ninguna. También se quitan
//   los enlaces "solo-admin" y "solo-gestion" como antes. Es solo
//   presentación: el backend igual responde 403 a los demás roles, y cada
//   página muestra "No tienes permiso…" si se abre escribiendo la URL.
// - Con sesión, quita el enlace "Login" (el login redirige a Pedidos si ya hay
//   sesión) y agrega "Cerrar sesión" al final del menú.
// - Contador de productos en alerta junto a "Alertas de stock": se consulta
//   una vez al entrar al panel (la primera página con sesión de la pestaña) y
//   se actualiza cada vez que se abre la sección. Sin consultas periódicas: se
//   guarda en sessionStorage junto con el final del token, así otra sesión no
//   ve el número de la anterior.
// Página → roles que pueden usarla, según el endpoint con que carga:
// mesas GET /api/mesas, pedidos GET /api/pedidos, productos GET /api/productos,
// proveedores GET /api/proveedores, inventario GET /api/inventario/movimientos,
// alertas GET /api/alertas-stock, ventas GET /api/ventas, reportes
// GET /api/reportes, asistente /api/chatbot, negocio GET /api/emisor/resolucion
// (el cajero puede leer /api/emisor, pero la página es de edición: solo admin),
// usuarios GET /api/usuarios.
const ROLES_POR_PAGINA = {
  "mesas.html": ["administrador", "cajero", "mesero"],
  "pedidos.html": ["administrador", "cajero", "mesero"],
  "productos.html": ["administrador", "cajero"],
  "proveedores.html": ["administrador", "cajero"],
  "inventario.html": ["administrador", "cajero"],
  "alertas.html": ["administrador", "cajero"],
  "ventas.html": ["administrador", "cajero"],
  "reportes.html": ["administrador", "cajero"],
  "asistente.html": ["administrador", "cajero"],
  "negocio.html": ["administrador"],
  "usuarios.html": ["administrador"],
};

// Función pura: ¿el rol ve esta página en el menú? Las que no están en la
// tabla (login) no dependen del rol.
function puedeVerPagina(rol, href) {
  const roles = ROLES_POR_PAGINA[href];
  return !roles || roles.includes(rol);
}

// Función pura: scrollLeft que deja la entrada activa centrada en la barra,
// limitado a [0, máximo]. Posiciones en px de pantalla (getBoundingClientRect).
// Si la barra no desborda (escritorio: menú vertical), devuelve el actual.
function scrollParaCentrar({ barraIzq, barraAncho, scrollActual, scrollAncho, itemIzq, itemAncho }) {
  const maximo = scrollAncho - barraAncho;
  if (!(maximo > 0)) return scrollActual;
  const destino = scrollActual + (itemIzq + itemAncho / 2) - (barraIzq + barraAncho / 2);
  return Math.round(Math.min(maximo, Math.max(0, destino)));
}

const MenuPanel = (() => {
  const CLAVE_CONTADOR = "contadorAlertas";
  const nav = document.querySelector(".sidebar .sidebar-nav");

  let rol = null;
  try {
    rol = JSON.parse(localStorage.getItem("usuario") || "null")?.rol;
  } catch {
    rol = null;
  }
  const gestiona = rol === "administrador" || rol === "cajero";
  const token = localStorage.getItem("token");
  const firma = token ? token.slice(-16) : null;

  // En celular el menú es una fila con scroll horizontal (panel.css, 720 px):
  // al cargar cada página se desplaza para dejar centrada la entrada .activo.
  // Solo mueve la barra (scrollLeft), nunca la página en vertical. En
  // escritorio la barra no desborda y no hace nada; sin entrada activa (o sin
  // las APIs del DOM) tampoco. Se llama después de armar el menú (quitar
  // entradas y agregar "Cerrar sesión") y otra vez si aparece el contador de
  // alertas, que cambia el ancho de las entradas.
  function centrarActiva() {
    try {
      const activa = nav && nav.querySelector(".nav-item.activo");
      if (!activa || typeof nav.getBoundingClientRect !== "function") return;
      const barra = nav.getBoundingClientRect();
      const item = activa.getBoundingClientRect();
      nav.scrollLeft = scrollParaCentrar({
        barraIzq: barra.left,
        barraAncho: nav.clientWidth,
        scrollActual: nav.scrollLeft,
        scrollAncho: nav.scrollWidth,
        itemIzq: item.left,
        itemAncho: item.width,
      });
    } catch {
      // solo presentación: nunca rompe el menú
    }
  }

  function mostrarContador(n) {
    const enlace = nav && nav.querySelector('a[href="alertas.html"]');
    if (!enlace) return;
    let contador = enlace.querySelector(".nav-contador");
    if (!Number.isInteger(n) || n <= 0) {
      if (contador) contador.remove();
      return;
    }
    if (!contador) {
      contador = document.createElement("span");
      contador.className = "nav-contador";
      enlace.appendChild(contador);
    }
    contador.textContent = n > 99 ? "99+" : String(n);
    contador.setAttribute("aria-label", `${n} ${n === 1 ? "producto" : "productos"} en alerta`);
    centrarActiva();
  }

  // La sección Alertas de stock llama esto con el número que acaba de mostrar.
  function actualizarContadorAlertas(n) {
    if (!firma) return;
    try {
      sessionStorage.setItem(CLAVE_CONTADOR, JSON.stringify({ firma, n }));
    } catch {
      // sin sessionStorage (modo privado estricto): solo se muestra
    }
    mostrarContador(n);
  }

  function contadorGuardado() {
    try {
      const guardado = JSON.parse(sessionStorage.getItem(CLAVE_CONTADOR) || "null");
      return guardado && guardado.firma === firma && Number.isInteger(guardado.n) ? guardado.n : null;
    } catch {
      return null;
    }
  }

  // Consulta silenciosa: un error (sin red, 401, 403) no muestra avisos ni contador.
  async function consultarContador() {
    try {
      const res = await fetch("/api/alertas-stock", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const datos = await res.json();
      const conocidos = ["agotado", "bajo_minimo", "por_agotarse"];
      const lista = Array.isArray(datos && datos.productos) ? datos.productos : [];
      actualizarContadorAlertas(lista.filter((p) => p && conocidos.includes(p.estado)).length);
    } catch {
      // sin contador
    }
  }

  if (nav) {
    if (rol !== "administrador") {
      for (const enlace of nav.querySelectorAll(".solo-admin")) enlace.remove();
    }
    if (!gestiona) {
      for (const enlace of nav.querySelectorAll(".solo-gestion")) enlace.remove();
    }
    for (const enlace of nav.querySelectorAll("a.nav-item")) {
      if (!puedeVerPagina(rol, enlace.getAttribute("href"))) enlace.remove();
    }

    if (token) {
      const login = nav.querySelector('a[href="login.html"]');
      if (login) login.remove();

      const salir = document.createElement("button");
      salir.type = "button";
      salir.className = "nav-item nav-salir";
      salir.innerHTML =
        '<svg class="nav-icon" viewBox="0 0 24 24"><path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" />' +
        '<path d="M9 12h12l-3 -3" /><path d="M18 15l3 -3" /></svg><span>Cerrar sesión</span>';
      salir.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("usuario");
        try {
          sessionStorage.removeItem(CLAVE_CONTADOR);
        } catch {
          // nada que borrar
        }
        // replace: "Atrás" no vuelve a una página del panel ya sin sesión.
        window.location.replace("login.html");
      });
      nav.appendChild(salir);

      // La página de alertas consulta por su cuenta y actualiza el contador.
      if (gestiona) {
        const guardado = contadorGuardado();
        if (guardado !== null) mostrarContador(guardado);
        else if (!/alertas\.html$/.test(window.location.pathname)) consultarContador();
      }
    }

    centrarActiva();
  }

  return { actualizarContadorAlertas, centrarActiva };
})();
