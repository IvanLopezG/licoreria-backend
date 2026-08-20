require("dotenv").config();
const bcrypt = require("bcryptjs");
const usuarioModel = require("./models/usuarioModel");
const categoriaModel = require("./models/categoriaModel");

const CATEGORIAS_INICIALES = ["Licor", "Paquetería"];
for (const nombreCategoria of CATEGORIAS_INICIALES) {
  if (!categoriaModel.buscarPorNombre(nombreCategoria)) {
    categoriaModel.crear({ nombre: nombreCategoria });
  }
}
console.log(`Categorías iniciales verificadas: ${CATEGORIAS_INICIALES.join(", ")}`);

const nombre = process.env.ADMIN_NOMBRE || "Administrador";
const usuario_login = process.env.ADMIN_LOGIN || "admin";
const password = process.env.ADMIN_PASSWORD || "CambiarEsta123";

if (usuarioModel.existeAdministrador()) {
  console.log("Ya existe al menos un administrador. No se creó ninguno nuevo.");
  process.exit(0);
}

const password_hash = bcrypt.hashSync(password, 10);
const admin = usuarioModel.crear({ nombre, usuario_login, password_hash, rol: "administrador" });

console.log("Administrador inicial creado:");
console.log(`  usuario_login: ${admin.usuario_login}`);
console.log(`  password:      ${password}  (cámbiala después de la primera prueba)`);
