// Gestión de usuarios de punta a punta (HTTP con la app real) contra un
// Postgres LOCAL desechable y recién creado (p. ej. PGlite). Nunca Supabase:
// se niega a correr si la base no es localhost o si ya tiene usuarios.
//
//   PRUEBA_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/postgres node scripts/test-usuarios.js
//
// Cubre: permisos (401/403), crear (201/400/409, sin password_hash), editar
// nombre/rol/contraseña, 400/404, desactivar con corte inmediato del token,
// reactivar, cambio de rol que aplica con el mismo token, protecciones del
// administrador (propio usuario, último administrador, carrera) y bitácora sin
// contraseñas ni hashes.
const URL_PRUEBA = process.env.PRUEBA_DATABASE_URL || "";
let host = "";
try {
  host = new URL(URL_PRUEBA).hostname;
} catch {
  // sin URL
}
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) || /supabase/i.test(URL_PRUEBA)) {
  console.error("Uso: PRUEBA_DATABASE_URL=<postgres LOCAL recién creado> node scripts/test-usuarios.js");
  process.exit(1);
}
process.env.DATABASE_URL = URL_PRUEBA;
process.env.PGSSLMODE = "disable";
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX || "1";
process.env.JWT_SECRET = "secreto-solo-para-test-usuarios";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

const bcrypt = require("bcryptjs");
const app = require("../src/app");
const db = require("../src/db/db");
const usuarioService = require("../src/services/usuarioService");

let fallos = 0;
let total = 0;
function comprobar(condicion, texto, extra) {
  total += 1;
  if (!condicion) fallos += 1;
  console.log(`${condicion ? "OK   " : "FALLA"} ${texto}${!condicion && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
}

// Contraseñas usadas en la prueba: ninguna puede aparecer en la bitácora.
const CLAVES = {
  admin: "AdminPrueba123",
  admin2: "AdminDos12345",
  cajero: "CajeroPrueba1",
  mesero: "MeseroPrueba1",
  editable: "Editable12345",
  editableNueva: "NuevaClave2026",
  adminNueva: "AdminNueva2026",
};

async function main() {
  await db.inicializarEsquema();
  const { n } = await db.uno("SELECT COUNT(*) AS n FROM usuarios");
  if (n > 0) {
    console.error("La base ya tiene usuarios: se necesita una base recién creada.");
    process.exitCode = 1;
    return;
  }
  await db.ejecutar("INSERT INTO usuarios (nombre, usuario_login, password_hash, rol) VALUES ('Admin Prueba', 'admin_prueba', $1, 'administrador')", [
    bcrypt.hashSync(CLAVES.admin, 10),
  ]);

  const servidor = app.listen(0);
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = async (metodo, ruta, { token, body } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const texto = await r.text();
    let cuerpo = null;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = texto;
    }
    return { status: r.status, body: cuerpo };
  };
  const login = (usuario_login, password) => pedir("POST", "/api/auth/login", { body: { usuario_login, password } });
  const tokenDe = async (u, p) => (await login(u, p)).body.token;

  try {
    const admin = await tokenDe("admin_prueba", CLAVES.admin);
    comprobar(typeof admin === "string", "login del administrador inicial");
    const me = await pedir("GET", "/api/auth/me", { token: admin });
    comprobar(
      me.status === 200 && JSON.stringify(Object.keys(me.body.usuario).sort()) === JSON.stringify(["exp", "iat", "id_usuario", "rol", "usuario_login"]),
      "GET /api/auth/me conserva la forma de req.usuario",
      me.body
    );
    const idAdmin = me.body.usuario.id_usuario;

    // ---------- Crear ----------
    const nuevo = (nombre, usuario_login, password, rol) => pedir("POST", "/api/usuarios", { token: admin, body: { nombre, usuario_login, password, rol } });
    const cajeroC = await nuevo("Cajero Prueba", "cajero_prueba_u", CLAVES.cajero, "cajero");
    comprobar(cajeroC.status === 201, "crear cajero → 201", cajeroC);
    comprobar(
      JSON.stringify(Object.keys(cajeroC.body).sort()) === JSON.stringify(["activo", "fecha_creacion", "id_usuario", "nombre", "rol", "usuario_login"]),
      "la respuesta de crear no trae password_hash (mismos campos de siempre)",
      Object.keys(cajeroC.body)
    );
    const meseroC = await nuevo("Mesero Prueba", "mesero_prueba_u", CLAVES.mesero, "mesero");
    comprobar(meseroC.status === 201, "crear mesero → 201");
    const dup = await nuevo("Otro", "cajero_prueba_u", CLAVES.cajero, "cajero");
    comprobar(dup.status === 409, "login duplicado → 409", dup);
    const corta = await nuevo("Corta", "corta_u", "1234567", "cajero");
    comprobar(corta.status === 400 && /al menos 8/.test(corta.body.error), "contraseña de 7 caracteres → 400", corta);
    const larga = await nuevo("Larga", "larga_u", "ñ".repeat(37), "cajero");
    comprobar(larga.status === 400 && /demasiado larga/.test(larga.body.error), "contraseña de más de 72 bytes → 400", larga);
    const rolMalo = await nuevo("Rol", "rol_u", CLAVES.cajero, "jefe");
    comprobar(rolMalo.status === 400 && /Rol inválido/.test(rolMalo.body.error), "rol inválido → 400", rolMalo);
    const faltan = await pedir("POST", "/api/usuarios", { token: admin, body: { nombre: "X" } });
    comprobar(faltan.status === 400, "faltan datos → 400");

    // ---------- Permisos ----------
    const cajero = await tokenDe("cajero_prueba_u", CLAVES.cajero);
    const mesero = await tokenDe("mesero_prueba_u", CLAVES.mesero);
    const idCajero = cajeroC.body.id_usuario;
    for (const [metodo, ruta, body] of [
      ["GET", "/api/usuarios"],
      ["POST", "/api/usuarios", { nombre: "X", usuario_login: "x_u", password: "Clave12345", rol: "mesero" }],
      ["PUT", `/api/usuarios/${idCajero}`, { nombre: "Hackeado" }],
    ]) {
      comprobar((await pedir(metodo, ruta, { body })).status === 401, `${metodo} ${ruta} sin token → 401`);
      comprobar((await pedir(metodo, ruta, { token: cajero, body })).status === 403, `${metodo} ${ruta} cajero → 403`);
      comprobar((await pedir(metodo, ruta, { token: mesero, body })).status === 403, `${metodo} ${ruta} mesero → 403`);
    }
    const lista = await pedir("GET", "/api/usuarios", { token: admin });
    comprobar(lista.status === 200 && lista.body.length === 3, "administrador lista los usuarios → 200");
    comprobar(lista.body.every((u) => !("password_hash" in u)), "el listado no trae password_hash");
    comprobar(lista.body.find((u) => u.id_usuario === idCajero).nombre === "Cajero Prueba", "el PUT del cajero (403) no cambió nada");

    // ---------- Editar ----------
    const editableC = await nuevo("Editable", "editable_u", CLAVES.editable, "mesero");
    const idEd = editableC.body.id_usuario;
    const editar = (id, body, token = admin) => pedir("PUT", `/api/usuarios/${id}`, { token, body });
    const ed = await editar(idEd, { nombre: "  Editable Cambiado  ", rol: "cajero", password: CLAVES.editableNueva });
    comprobar(ed.status === 200 && ed.body.nombre === "Editable Cambiado" && ed.body.rol === "cajero", "editar nombre, rol y contraseña → 200", ed);
    comprobar(!("password_hash" in ed.body) && ed.body.usuario_login === "editable_u", "la respuesta de editar no trae password_hash");
    comprobar((await login("editable_u", CLAVES.editableNueva)).status === 200, "login con la contraseña nueva → 200");
    comprobar((await login("editable_u", CLAVES.editable)).status === 401, "login con la contraseña vieja → 401");
    const vacio = await editar(idEd, {});
    comprobar(vacio.status === 400 && /al menos un campo/.test(vacio.body.error), "cuerpo vacío → 400", vacio);
    comprobar((await editar(idEd, { otro: 1 })).status === 400, "solo campos desconocidos → 400");
    comprobar((await editar(999999, { nombre: "Nadie" })).status === 404, "id inexistente → 404");
    comprobar((await editar("abc", { nombre: "Nadie" })).status === 400, "id no numérico → 400");
    comprobar((await editar("0", { nombre: "Nadie" })).status === 400, "id 0 → 400");
    comprobar((await editar(idEd, { nombre: "   " })).status === 400, "nombre vacío → 400");
    comprobar((await editar(idEd, { rol: "jefe" })).status === 400, "rol inválido → 400");
    comprobar((await editar(idEd, { activo: "si" })).status === 400, "activo inválido → 400");
    comprobar((await editar(idEd, { password: "corta" })).status === 400, "contraseña corta → 400");
    comprobar((await editar(idEd, { usuario_login: "otro_login" })).status === 400, "usuario_login no editable → 400");
    comprobar((await editar(idEd, { usuario_login: "editable_u", nombre: "Editable" })).status === 200, "usuario_login igual al guardado se ignora → 200");

    // ---------- Desactivar: corte inmediato ----------
    const tokenEd = await tokenDe("editable_u", CLAVES.editableNueva);
    comprobar((await pedir("GET", "/api/productos", { token: tokenEd })).status === 200, "token del usuario activo funciona");
    const des = await editar(idEd, { activo: 0 });
    comprobar(des.status === 200 && des.body.activo === 0, "desactivar → 200 con activo 0", des);
    comprobar((await pedir("GET", "/api/productos", { token: tokenEd })).status === 401, "el token emitido antes recibe 401 al instante");
    comprobar((await login("editable_u", CLAVES.editableNueva)).status === 401, "el usuario inactivo no puede iniciar sesión");
    const rea = await editar(idEd, { activo: true });
    comprobar(rea.status === 200 && rea.body.activo === 1, "reactivar con activo:true → 200 con activo 1", rea);
    const tokenEd2 = await tokenDe("editable_u", CLAVES.editableNueva);
    comprobar((await pedir("GET", "/api/productos", { token: tokenEd2 })).status === 200, "reactivado: login nuevo y petición → 200");

    // ---------- Cambio de rol con el mismo token ----------
    const idMesero = meseroC.body.id_usuario;
    comprobar((await pedir("GET", "/api/productos", { token: mesero })).status === 403, "mesero → 403 en productos");
    await editar(idMesero, { rol: "cajero" });
    comprobar((await pedir("GET", "/api/productos", { token: mesero })).status === 200, "pasa a cajero: el mismo token ya tiene permiso → 200");
    await editar(idMesero, { rol: "mesero" });
    comprobar((await pedir("GET", "/api/productos", { token: mesero })).status === 403, "vuelve a mesero: el mismo token → 403");

    // ---------- Protecciones del administrador ----------
    const propioDes = await editar(idAdmin, { activo: 0 });
    comprobar(propioDes.status === 409 && propioDes.body.error === "No puedes desactivar tu propio usuario.", "desactivarse a sí mismo → 409", propioDes);
    const propioRol = await editar(idAdmin, { rol: "cajero" });
    comprobar(propioRol.status === 409 && propioRol.body.error === "No puedes cambiar tu propio rol.", "cambiarse el rol → 409", propioRol);
    comprobar((await editar(idAdmin, { rol: "administrador", activo: 1 })).status === 200, "enviar su mismo rol y activo (sin cambio) → 200");
    const propioOk = await editar(idAdmin, { nombre: "Admin Renombrado", password: CLAVES.adminNueva });
    comprobar(propioOk.status === 200 && propioOk.body.nombre === "Admin Renombrado", "cambiar su propio nombre y contraseña → 200");
    comprobar((await login("admin_prueba", CLAVES.adminNueva)).status === 200, "el administrador entra con su contraseña nueva");
    comprobar((await pedir("GET", "/api/usuarios", { token: admin })).status === 200, "su token sigue valiendo tras cambiar su contraseña");

    // Último administrador activo: la regla en el servicio (por HTTP no se llega
    // sin carrera: quien edita es un administrador activo distinto del editado).
    try {
      await usuarioService.editarUsuario(String(idAdmin), { activo: 0 }, { id_usuario: -1 });
      comprobar(false, "dejar el sistema sin administrador activo → 409");
    } catch (err) {
      comprobar(err.status === 409 && /al menos un administrador activo/.test(err.message), "dejar el sistema sin administrador activo → 409", err.message);
    }
    try {
      await usuarioService.editarUsuario(String(idAdmin), { rol: "mesero" }, { id_usuario: -1 });
      comprobar(false, "quitarle el rol al último administrador → 409");
    } catch (err) {
      comprobar(err.status === 409, "quitarle el rol al último administrador → 409", err.message);
    }

    // Carrera: dos administradores se desactivan entre sí a la vez.
    const admin2C = await nuevo("Admin Dos", "admin_dos_u", CLAVES.admin2, "administrador");
    const idAdmin2 = admin2C.body.id_usuario;
    const admin2 = await tokenDe("admin_dos_u", CLAVES.admin2);
    const [r1, r2] = await Promise.all([editar(idAdmin2, { activo: 0 }, admin), editar(idAdmin, { activo: 0 }, admin2)]);
    const estados = [r1.status, r2.status].sort();
    comprobar(estados.includes(200) && !estados.every((s) => s === 200), "carrera por HTTP: solo uno se aplica", estados);
    comprobar(estados.some((s) => s === 409 || s === 401), "carrera por HTTP: el otro recibe 409 (o 401 si su autenticación ya vio el cambio)", estados);
    // Mismo choque sin la autenticación de por medio: el segundo siempre 409.
    await db.ejecutar("UPDATE usuarios SET activo = 1 WHERE id_usuario IN ($1, $2)", [idAdmin, idAdmin2]);
    const resultados = await Promise.allSettled([
      usuarioService.editarUsuario(String(idAdmin2), { activo: 0 }, { id_usuario: idAdmin }),
      usuarioService.editarUsuario(String(idAdmin), { activo: 0 }, { id_usuario: idAdmin2 }),
    ]);
    const ok = resultados.filter((r) => r.status === "fulfilled").length;
    const conflictos = resultados.filter((r) => r.status === "rejected" && r.reason.status === 409).length;
    comprobar(ok === 1 && conflictos === 1, "carrera en el servicio: uno 200 y el otro 409", resultados.map((r) => r.status));
    const { activos } = await db.uno("SELECT COUNT(*) AS activos FROM usuarios WHERE rol = 'administrador' AND activo = 1");
    comprobar(activos === 1, "tras la carrera queda exactamente un administrador activo", activos);
    await db.ejecutar("UPDATE usuarios SET activo = 1 WHERE id_usuario IN ($1, $2)", [idAdmin, idAdmin2]);

    // ---------- Bitácora ----------
    const bitacora = await db.todos("SELECT row_to_json(l)::text AS fila, accion, detalle FROM log_auditoria l WHERE entidad = 'usuarios' ORDER BY id_log");
    comprobar(bitacora.some((b) => b.accion === "crear"), "bitácora: hay registros de crear usuario");
    comprobar(bitacora.some((b) => b.accion === "editar" && /rol: mesero → cajero/.test(b.detalle || "")), "bitácora: editar guarda rol anterior y nuevo");
    comprobar(bitacora.some((b) => b.accion === "editar" && /contraseña cambiada/.test(b.detalle || "")), "bitácora: la contraseña solo como 'contraseña cambiada'");
    comprobar(bitacora.some((b) => /activo: 1 → 0/.test(b.detalle || "")), "bitácora: activo anterior y nuevo");
    const todo = (await db.todos("SELECT row_to_json(l)::text AS fila FROM log_auditoria l")).map((r) => r.fila).join("\n");
    const hashes = (await db.todos("SELECT password_hash FROM usuarios")).map((r) => r.password_hash);
    const secretos = [...Object.values(CLAVES), ...hashes];
    comprobar(secretos.every((s) => !todo.includes(s)), "ninguna columna de log_auditoria contiene contraseñas ni hashes");
    comprobar(!/\$2[aby]\$/.test(todo), "ningún texto con forma de hash bcrypt en la bitácora");
  } finally {
    await new Promise((r) => servidor.close(r));
    await db.pool.end();
  }
  console.log(`\n${total - fallos}/${total} comprobaciones OK`);
  if (fallos) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
