// Menú lateral del panel (lo cargan todas las páginas menos el login):
// - Oculta los enlaces "solo-admin" (p. ej. Datos del negocio) cuando quien
//   inició sesión no es administrador. Es solo presentación: el backend igual
//   responde 403 a los demás roles.
// - Con sesión, quita el enlace "Login" (el login redirige a Pedidos si ya hay
//   sesión) y agrega "Cerrar sesión" al final del menú.
(() => {
  const nav = document.querySelector(".sidebar .sidebar-nav");
  if (!nav) return; // sin sesión, la página reemplaza su contenido por un aviso

  let rol = null;
  try {
    rol = JSON.parse(localStorage.getItem("usuario") || "null")?.rol;
  } catch {
    rol = null;
  }
  if (rol !== "administrador") {
    for (const enlace of nav.querySelectorAll(".solo-admin")) enlace.remove();
  }

  if (!localStorage.getItem("token")) return;

  nav.querySelector('a[href="login.html"]')?.remove();

  const salir = document.createElement("button");
  salir.type = "button";
  salir.className = "nav-item nav-salir";
  salir.innerHTML =
    '<svg class="nav-icon" viewBox="0 0 24 24"><path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" />' +
    '<path d="M9 12h12l-3 -3" /><path d="M18 15l3 -3" /></svg><span>Cerrar sesión</span>';
  salir.addEventListener("click", () => {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    // replace: "Atrás" no vuelve a una página del panel ya sin sesión.
    window.location.replace("login.html");
  });
  nav.appendChild(salir);
})();
