// Menú lateral del panel (lo cargan todas las páginas menos el login):
// - Oculta los enlaces "solo-admin" (p. ej. Datos del negocio) cuando quien
//   inició sesión no es administrador, y los "solo-gestion" (Alertas de stock,
//   Reportes, Asistente) cuando no es administrador ni cajero. Es solo
//   presentación: el backend igual responde 403 a los demás roles.
// - Con sesión, quita el enlace "Login" (el login redirige a Pedidos si ya hay
//   sesión) y agrega "Cerrar sesión" al final del menú.
// - Contador de productos en alerta junto a "Alertas de stock": se consulta
//   una vez al entrar al panel (la primera página con sesión de la pestaña) y
//   se actualiza cada vez que se abre la sección. Sin consultas periódicas: se
//   guarda en sessionStorage junto con el final del token, así otra sesión no
//   ve el número de la anterior.
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
  }

  return { actualizarContadorAlertas };
})();
