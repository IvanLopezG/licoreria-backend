const bcrypt = require("bcryptjs");
const db = require("../db/db");
const usuarioModel = require("../models/usuarioModel");
const { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } = require("../utils/errores");
const { validarContrasena } = require("../utils/contrasena");

const ROLES_VALIDOS = ["administrador", "mesero", "cajero"];
const SALT_ROUNDS = 10;

async function crearUsuario({ nombre, usuario_login, password, rol }) {
  if (!nombre || !usuario_login || !password || !rol) {
    throw new ErrorValidacion("nombre, usuario_login, password y rol son obligatorios.");
  }

  if (!ROLES_VALIDOS.includes(rol)) {
    throw new ErrorValidacion(`Rol inválido. Debe ser uno de: ${ROLES_VALIDOS.join(", ")}.`);
  }

  validarContrasena(password);

  if (await usuarioModel.buscarPorLogin(usuario_login)) {
    throw new ErrorConflicto("Ya existe un usuario con ese usuario_login.");
  }

  const password_hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const usuario = await usuarioModel.crear({ nombre, usuario_login, password_hash, rol });

  const { password_hash: _omit, ...usuarioSinPassword } = usuario;
  return usuarioSinPassword;
}

function listarUsuarios() {
  return usuarioModel.listar();
}

// ---------- Edición (PUT /api/usuarios/:id) ----------

function leerId(valor) {
  const id = /^\d{1,10}$/.test(String(valor)) ? Number(valor) : NaN;
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new ErrorValidacion("El id del usuario no es válido.");
  return id;
}

// activo acepta 0/1 o true/false (se guarda 0/1); nada más.
function leerActivo(valor) {
  if (valor === 1 || valor === true) return 1;
  if (valor === 0 || valor === false) return 0;
  throw new ErrorValidacion("activo debe ser 0, 1, true o false.");
}

// Solo los campos editables que llegaron, ya validados. usuario_login no se
// edita: si llega distinto al guardado se rechaza (ver editarUsuario).
function leerCambios(cuerpo) {
  const cambios = {};
  if (cuerpo.nombre !== undefined) {
    if (typeof cuerpo.nombre !== "string" || !cuerpo.nombre.trim()) throw new ErrorValidacion("El nombre no puede quedar vacío.");
    cambios.nombre = cuerpo.nombre.trim();
  }
  if (cuerpo.rol !== undefined) {
    if (!ROLES_VALIDOS.includes(cuerpo.rol)) throw new ErrorValidacion(`Rol inválido. Debe ser uno de: ${ROLES_VALIDOS.join(", ")}.`);
    cambios.rol = cuerpo.rol;
  }
  if (cuerpo.activo !== undefined) cambios.activo = leerActivo(cuerpo.activo);
  if (cuerpo.password !== undefined) {
    validarContrasena(cuerpo.password);
    cambios.password = cuerpo.password;
  }
  if (Object.keys(cambios).length === 0) {
    throw new ErrorValidacion("Envía al menos un campo para editar: nombre, rol, activo o password.");
  }
  return cambios;
}

// Texto de la bitácora: valores anterior y nuevo de nombre, rol y activo; de la
// contraseña solo que cambió (nunca el valor ni el hash).
function detalleCambios(antes, cambios) {
  const partes = [];
  if (cambios.nombre !== undefined && cambios.nombre !== antes.nombre) partes.push(`nombre: "${antes.nombre}" → "${cambios.nombre}"`);
  if (cambios.rol !== undefined && cambios.rol !== antes.rol) partes.push(`rol: ${antes.rol} → ${cambios.rol}`);
  if (cambios.activo !== undefined && cambios.activo !== Number(antes.activo)) partes.push(`activo: ${antes.activo} → ${cambios.activo}`);
  if (cambios.password !== undefined) partes.push("contraseña cambiada");
  return partes.length ? partes.join("; ") : "Sin cambios";
}

// actor: el usuario que edita (req.usuario). Devuelve { usuario, detalle }.
async function editarUsuario(idParam, cuerpo, actor) {
  const id = leerId(idParam);
  const cambios = leerCambios(cuerpo || {});
  // El hash se calcula antes de la transacción, para no tener filas bloqueadas
  // mientras bcrypt trabaja.
  const password_hash = cambios.password !== undefined ? bcrypt.hashSync(cambios.password, SALT_ROUNDS) : undefined;
  const afectaAdministradores = cambios.rol !== undefined || cambios.activo !== undefined;

  return db.conTransaccion(async (cx) => {
    const filas = await usuarioModel.bloquearParaEditar(id, afectaAdministradores, cx);
    const antes = filas.find((f) => f.id_usuario === id);
    if (!antes) throw new ErrorNoEncontrado("Usuario no encontrado.");

    if (cuerpo.usuario_login !== undefined && cuerpo.usuario_login !== antes.usuario_login) {
      throw new ErrorValidacion("El usuario (usuario_login) no se puede cambiar.");
    }

    const esPropio = actor && actor.id_usuario === id;
    if (esPropio && cambios.activo === 0) {
      throw new ErrorConflicto("No puedes desactivar tu propio usuario.", "USUARIO_DESACTIVA_PROPIO");
    }
    if (esPropio && cambios.rol !== undefined && cambios.rol !== antes.rol) {
      throw new ErrorConflicto("No puedes cambiar tu propio rol.", "USUARIO_CAMBIA_PROPIO_ROL");
    }

    // Debe quedar al menos un administrador activo (filas ya bloqueadas).
    const eraAdminActivo = antes.rol === "administrador" && Number(antes.activo) === 1;
    const rolFinal = cambios.rol ?? antes.rol;
    const activoFinal = cambios.activo ?? Number(antes.activo);
    if (eraAdminActivo && (rolFinal !== "administrador" || activoFinal !== 1)) {
      const otros = filas.filter((f) => f.id_usuario !== id && f.rol === "administrador" && Number(f.activo) === 1);
      if (otros.length === 0) {
        throw new ErrorConflicto(
          "Debe quedar al menos un administrador activo: activa o crea otro administrador antes de hacer este cambio.",
          "USUARIO_ULTIMO_ADMINISTRADOR"
        );
      }
    }

    const campos = {};
    if (cambios.nombre !== undefined && cambios.nombre !== antes.nombre) campos.nombre = cambios.nombre;
    if (cambios.rol !== undefined && cambios.rol !== antes.rol) campos.rol = cambios.rol;
    if (cambios.activo !== undefined && cambios.activo !== Number(antes.activo)) campos.activo = cambios.activo;
    if (password_hash !== undefined) campos.password_hash = password_hash;
    await usuarioModel.actualizar(id, campos, cx);

    return { usuario: await usuarioModel.buscarPublico(id, cx), detalle: detalleCambios(antes, cambios) };
  });
}

module.exports = { crearUsuario, listarUsuarios, editarUsuario, ROLES_VALIDOS };
