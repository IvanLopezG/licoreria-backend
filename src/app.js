require("dotenv").config({ quiet: true }); // quiet: sin aviso en stdout (los logs son JSON)
const path = require("path");
const express = require("express");
const cors = require("cors");

const auditoria = require("./middlewares/auditoria");
const registroPeticiones = require("./middlewares/registroPeticiones");
const { manejoErrores, rutaNoEncontrada } = require("./middlewares/manejoErrores");
const authRoutes = require("./routes/auth.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const auditoriaRoutes = require("./routes/auditoria.routes");
const categoriasRoutes = require("./routes/categorias.routes");
const productosRoutes = require("./routes/productos.routes");
const proveedoresRoutes = require("./routes/proveedores.routes");
const inventarioRoutes = require("./routes/inventario.routes");
const mesasRoutes = require("./routes/mesas.routes");
const catalogoRoutes = require("./routes/catalogo.routes");
const pedidosRoutes = require("./routes/pedidos.routes");
const ventasRoutes = require("./routes/ventas.routes");
const facturasRoutes = require("./routes/facturas.routes");
const emisorRoutes = require("./routes/emisor.routes");

const app = express();
// Render atiende detrás de un proxy: req.ip es la IP real del cliente (la usa
// el limitador de intentos del catálogo público).
app.set("trust proxy", 1);
// Log de cada petición (Pino): método, ruta, código y tiempo. Ver utils/logger.js.
app.use(registroPeticiones);

app.use(cors());
app.use(express.json());
// Sin cuerpo JSON, Express 5 deja req.body en undefined: se normaliza a {} para
// que la validación de cada servicio responda su 400 en español en vez de un
// TypeError (que el manejador central convertiría en 500).
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});
app.use(auditoria); // se activa solo cuando un controlador fija req.auditoria

app.use("/api/auth", authRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/auditoria", auditoriaRoutes);
app.use("/api/categorias", categoriasRoutes);
app.use("/api/productos", productosRoutes);
app.use("/api/proveedores", proveedoresRoutes);
app.use("/api/inventario", inventarioRoutes);
app.use("/api/mesas", mesasRoutes);
app.use("/api/catalogo", catalogoRoutes); // público, sin login (RF-11/RF-12)
app.use("/api/pedidos", pedidosRoutes);
app.use("/api/ventas", ventasRoutes);
app.use("/api/facturas", facturasRoutes);
app.use("/api/emisor", emisorRoutes);

app.use("/panel", express.static(path.join(__dirname, "..", "public", "panel")));
app.use("/catalogo", express.static(path.join(__dirname, "..", "public", "catalogo")));

// Quien entra directo al dominio cae en el login del panel, en vez de ver
// el JSON crudo de "ruta no encontrada".
app.get("/", (req, res) => res.redirect("/panel/login.html"));

app.get("/api/salud", (req, res) => res.json({ estado: "ok" }));

app.use(rutaNoEncontrada);
// Manejador central de errores: siempre el último (ver middlewares/manejoErrores.js).
app.use(manejoErrores);

module.exports = app;
