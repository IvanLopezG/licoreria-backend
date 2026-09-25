// Facturación en el panel: campos opcionales al cobrar (forma de pago y
// cliente), abrir el PDF de una factura y anularla (solo administrador).
// Lo usan pedidos.html (cierre de mesa) y ventas.html (mostrador y reporte).
const Factura = (() => {
  const FORMAS_PAGO = [
    ["efectivo", "Efectivo"],
    ["tarjeta_debito", "Tarjeta débito"],
    ["tarjeta_credito", "Tarjeta crédito"],
    ["transferencia", "Transferencia"],
  ];
  const TIPOS_DOC = [
    ["CC", "Cédula de ciudadanía"],
    ["NIT", "NIT"],
    ["CE", "Cédula de extranjería"],
    ["PP", "Pasaporte"],
  ];

  const token = () => localStorage.getItem("token");
  const el = (id) => document.getElementById(id);
  const opciones = (lista) => lista.map(([valor, texto]) => `<option value="${valor}">${texto}</option>`).join("");

  function esAdmin() {
    try {
      return JSON.parse(localStorage.getItem("usuario") || "null")?.rol === "administrador";
    } catch {
      return false;
    }
  }

  // Pinta los campos dentro de un contenedor. "p" es un prefijo para los ids,
  // así la misma página puede tener más de un formulario.
  function pintarCampos(contenedor, p) {
    contenedor.innerHTML = `
      <label>Forma de pago
        <select id="${p}FormaPago">${opciones(FORMAS_PAGO)}</select>
      </label>
      <label style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" id="${p}ConCliente" style="width:auto; margin:0;"> Identificar cliente (si pide factura a su nombre)
      </label>
      <div id="${p}Cliente" class="oculto">
        <div class="fila-form">
          <label>Tipo de documento
            <select id="${p}TipoDoc">${opciones(TIPOS_DOC)}</select>
          </label>
          <label>Número
            <input id="${p}NumDoc" inputmode="numeric" autocomplete="off">
          </label>
          <label id="${p}DvLabel" class="oculto" style="max-width:80px; min-width:60px;">DV
            <input id="${p}Dv" inputmode="numeric" maxlength="1" autocomplete="off">
          </label>
        </div>
        <label>Nombre o razón social
          <input id="${p}Nombre" autocomplete="off">
        </label>
      </div>
    `;
    el(`${p}ConCliente`).addEventListener("change", (e) => el(`${p}Cliente`).classList.toggle("oculto", !e.target.checked));
    el(`${p}TipoDoc`).addEventListener("change", (e) => el(`${p}DvLabel`).classList.toggle("oculto", e.target.value !== "NIT"));
  }

  // Devuelve { datos } para el body, o { error } si el cliente está incompleto.
  function leerCampos(p) {
    const datos = { forma_pago: el(`${p}FormaPago`).value };
    if (!el(`${p}ConCliente`).checked) return { datos };

    const tipo_doc = el(`${p}TipoDoc`).value;
    const num_doc = el(`${p}NumDoc`).value.trim();
    const nombre = el(`${p}Nombre`).value.trim();
    const dv = tipo_doc === "NIT" ? el(`${p}Dv`).value.trim() : "";
    if (!num_doc || !nombre) return { error: "Para identificar al cliente se necesitan el número de documento y el nombre." };

    datos.cliente = { tipo_doc, num_doc, nombre, ...(dv ? { dv } : {}) };
    return { datos };
  }

  function limpiarCampos(p) {
    el(`${p}FormaPago`).value = "efectivo";
    el(`${p}ConCliente`).checked = false;
    el(`${p}Cliente`).classList.add("oculto");
    for (const campo of ["NumDoc", "Dv", "Nombre"]) el(`${p}${campo}`).value = "";
    el(`${p}TipoDoc`).value = "CC";
    el(`${p}DvLabel`).classList.add("oculto");
  }

  // El PDF exige el token, así que no sirve un enlace directo: se descarga con
  // fetch y se abre como blob. La pestaña se abre antes del fetch, dentro del
  // clic, para que el navegador no la bloquee como ventana emergente.
  async function abrirPdf(id_factura) {
    const pestana = window.open("", "_blank");
    const res = await fetch(`/api/facturas/${id_factura}/pdf`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      pestana?.close();
      const data = await res.json().catch(() => ({}));
      alert(data.error || "No se pudo abrir el PDF de la factura.");
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    if (pestana) pestana.location = url;
    else window.location = url;
  }

  // Modal de anulación (solo administrador). "esMesa" habilita la opción de
  // reabrir los pedidos para volver a cobrarlos en la mesa.
  function pedirAnulacion({ id_factura, numero, esMesa, onListo }) {
    const fondo = document.createElement("div");
    fondo.style.cssText =
      "position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:10;";
    fondo.innerHTML = `
      <div style="background:white; padding:24px; border-radius:6px; width:min(420px, 92vw);">
        <h2 style="margin-top:0;">Anular factura ${numero}</h2>
        <p style="font-size:13px;">Se revierte la venta y el stock vuelve al inventario. El número no se reutiliza.</p>
        <label>Motivo (mínimo 10 caracteres)
          <input id="anularMotivo" autocomplete="off">
        </label>
        ${esMesa ? `
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" id="anularReabrir" style="width:auto; margin:0;" checked>
          Reabrir los pedidos de la mesa para volver a cobrarlos
        </label>` : ""}
        <p id="anularError" class="oculto" style="color:var(--rojo); font-size:13px;"></p>
        <button type="button" class="btn btn-peligro" id="anularConfirmar">Anular</button>
        <button type="button" class="btn btn-secundario" id="anularCancelar">Cancelar</button>
      </div>
    `;
    document.body.appendChild(fondo);
    el("anularMotivo").focus();

    const cerrar = () => fondo.remove();
    el("anularCancelar").onclick = cerrar;
    el("anularConfirmar").onclick = async () => {
      const motivo = el("anularMotivo").value.trim();
      const error = el("anularError");
      if (motivo.length < 10) {
        error.textContent = "El motivo debe tener al menos 10 caracteres.";
        error.classList.remove("oculto");
        return;
      }
      el("anularConfirmar").disabled = true;
      const res = await fetch(`/api/facturas/${id_factura}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ motivo, reabrir_pedidos: esMesa ? el("anularReabrir").checked : false }),
      });
      const data = await res.json();
      if (!res.ok) {
        error.textContent = data.error || "No se pudo anular la factura.";
        error.classList.remove("oculto");
        el("anularConfirmar").disabled = false;
        return;
      }
      cerrar();
      onListo?.(data);
    };
  }

  return { pintarCampos, leerCampos, limpiarCampos, abrirPdf, pedirAnulacion, esAdmin };
})();
