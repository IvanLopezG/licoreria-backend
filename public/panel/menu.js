// Oculta del menú lateral los enlaces marcados como "solo-admin" (p. ej. Datos
// del negocio) cuando quien inició sesión no es administrador. Es solo
// presentación: el backend igual responde 403 a los demás roles.
(() => {
  let rol = null;
  try {
    rol = JSON.parse(localStorage.getItem("usuario") || "null")?.rol;
  } catch {
    rol = null;
  }
  if (rol === "administrador") return;
  for (const enlace of document.querySelectorAll(".sidebar .solo-admin")) enlace.remove();
})();
