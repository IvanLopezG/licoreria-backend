// Llamadas a la API y avisos al usuario, compartidos por todas las pantallas
// (panel y catálogo). Toda petición pasa por Api.pedir: si la respuesta es un
// error (4xx/5xx), la red falla o el servidor no devuelve JSON, lanza un
// ApiError con un mensaje legible (el campo "error" de la API cuando existe),
// así ninguna pantalla muestra el JSON crudo de la respuesta.
const Api = (() => {
  class ApiError extends Error {
    constructor(mensaje, status) {
      super(mensaje);
      this.name = "ApiError";
      this.status = status; // 0 si no hubo respuesta (red caída)
    }
  }

  const SIN_CONEXION = "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";

  // opciones: { method, body (objeto, se envía como JSON), auth (por defecto
  // true: agrega el token del panel), respuesta: "json" | "blob" | "texto" }.
  async function pedir(ruta, { method = "GET", body, auth = true, respuesta = "json" } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = auth ? localStorage.getItem("token") : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(ruta, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(SIN_CONEXION, 0);
    }

    if (!res.ok) {
      let mensaje = null;
      try {
        mensaje = (await res.json()).error;
      } catch {
        // Respuesta sin JSON (p. ej. la página de error del proxy de Render).
      }
      throw new ApiError(mensaje || mensajePorEstado(res.status), res.status);
    }

    if (respuesta === "blob") return res.blob();
    if (respuesta === "texto") return res.text();
    try {
      return await res.json();
    } catch {
      throw new ApiError("El servidor devolvió una respuesta inesperada. Inténtalo de nuevo.", res.status);
    }
  }

  function mensajePorEstado(status) {
    if (status === 401) return "Tu sesión expiró. Vuelve a iniciar sesión.";
    if (status === 403) return "No tienes permiso para esta acción.";
    if (status === 404) return "No se encontró lo que buscabas.";
    if (status >= 500) return `Error del servidor (${status}). Inténtalo de nuevo en un momento.`;
    return `No se pudo completar la acción (error ${status}).`;
  }

  // Mensaje para mostrar de cualquier error capturado (ApiError u otro).
  function mensajeDe(err) {
    return err instanceof ApiError ? err.message : "Ocurrió un error inesperado. Inténtalo de nuevo.";
  }

  // ---------- Avisos (toast) ----------
  // Autocontenidos (inyectan su estilo) para funcionar también en el catálogo,
  // que no carga panel.css. Un mismo mensaje no se apila: si ya está visible
  // solo se renueva, así el polling cada 5 s no llena la pantalla de avisos.

  let contenedor = null;
  const visibles = new Map(); // texto -> { nodo, temporizador }

  function prepararContenedor() {
    if (contenedor) return contenedor;
    const estilo = document.createElement("style");
    estilo.textContent = `
      .api-avisos { position: fixed; right: 16px; bottom: 16px; z-index: 1000; display: flex; flex-direction: column;
        gap: 8px; max-width: min(380px, calc(100vw - 32px)); font-family: Calibri, Arial, sans-serif; }
      .api-aviso { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 6px;
        font-size: 14px; line-height: 1.35; box-shadow: 0 4px 14px rgba(0,0,0,.18); border-left: 4px solid; }
      .api-aviso.error { background: #FBE4E4; color: #8B0000; border-color: #8B0000; }
      .api-aviso.exito { background: #E3F5E9; color: #1E7A42; border-color: #1E7A42; }
      .api-aviso span { flex: 1; }
      .api-aviso button { background: none; border: 0; color: inherit; font-size: 18px; line-height: 1; cursor: pointer; padding: 0; }
    `;
    document.head.appendChild(estilo);
    contenedor = document.createElement("div");
    contenedor.className = "api-avisos";
    contenedor.setAttribute("aria-live", "polite");
    document.body.appendChild(contenedor);
    return contenedor;
  }

  function aviso(texto, tipo = "error") {
    const caja = prepararContenedor();
    const duracion = tipo === "error" ? 7000 : 3500;
    const existente = visibles.get(texto);
    if (existente) {
      clearTimeout(existente.temporizador);
      existente.temporizador = setTimeout(() => quitar(texto), duracion);
      return;
    }
    const nodo = document.createElement("div");
    nodo.className = `api-aviso ${tipo}`;
    nodo.setAttribute("role", tipo === "error" ? "alert" : "status");
    const span = document.createElement("span");
    span.textContent = texto;
    const cerrar = document.createElement("button");
    cerrar.type = "button";
    cerrar.setAttribute("aria-label", "Cerrar aviso");
    cerrar.textContent = "×";
    cerrar.onclick = () => quitar(texto);
    nodo.append(span, cerrar);
    caja.appendChild(nodo);
    visibles.set(texto, { nodo, temporizador: setTimeout(() => quitar(texto), duracion) });
  }

  function quitar(texto) {
    const v = visibles.get(texto);
    if (!v) return;
    clearTimeout(v.temporizador);
    v.nodo.remove();
    visibles.delete(texto);
  }

  const error = (err) => aviso(typeof err === "string" ? err : mensajeDe(err), "error");
  const exito = (texto) => aviso(texto, "exito");

  return { pedir, ApiError, mensajeDe, error, exito };
})();
