require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db/db");
const usuarioModel = require("./models/usuarioModel");
const categoriaModel = require("./models/categoriaModel");
const facturaService = require("./services/facturaService");

const CATEGORIAS_INICIALES = ["Licor", "Paquetería"];

// Idempotente: aplica schema.sql (CREATE ... IF NOT EXISTS) y solo crea lo que
// falta. Con Postgres los datos persisten entre despliegues, así que en Render
// este paso normalmente no crea nada.
async function main() {
  await db.inicializarEsquema();
  console.log("Esquema verificado.");

  for (const nombreCategoria of CATEGORIAS_INICIALES) {
    if (!(await categoriaModel.buscarPorNombre(nombreCategoria))) {
      await categoriaModel.crear({ nombre: nombreCategoria });
    }
  }
  console.log(`Categorías iniciales verificadas: ${CATEGORIAS_INICIALES.join(", ")}`);

  await facturaService.asegurarDatosIniciales();
  console.log("Emisor y secuencia de facturación verificados.");

  const nombre = process.env.ADMIN_NOMBRE || "Administrador";
  const usuario_login = process.env.ADMIN_LOGIN || "admin";
  const password = process.env.ADMIN_PASSWORD || "CambiarEsta123";

  if (await usuarioModel.existeAdministrador()) {
    console.log("Ya existe al menos un administrador. No se creó ninguno nuevo.");
    return;
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const admin = await usuarioModel.crear({ nombre, usuario_login, password_hash, rol: "administrador" });

  // La contraseña no se imprime: en Render los logs quedan guardados.
  console.log(`Administrador inicial creado: ${admin.usuario_login} (contraseña tomada de ADMIN_PASSWORD).`);
}

main()
  .catch((err) => {
    console.error("Error en el seed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
