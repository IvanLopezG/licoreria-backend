require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const auditoria = require("./middlewares/auditoria");
const authRoutes = require("./routes/auth.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const auditoriaRoutes = require("./routes/auditoria.routes");
const categoriasRoutes = require("./routes/categorias.routes");
const productosRoutes = require("./routes/productos.routes");
const proveedoresRoutes = require("./routes/proveedores.routes");
const inventarioRoutes = require("./routes/inventario.routes");
const mesasRoutes = require("./routes/mesas.routes");

const app = express();

app.use(cors());
app.use(express.json());
app.use(auditoria); // se activa solo cuando un controlador fija req.auditoria

app.use("/api/auth", authRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/auditoria", auditoriaRoutes);
app.use("/api/categorias", categoriasRoutes);
app.use("/api/productos", productosRoutes);
app.use("/api/proveedores", proveedoresRoutes);
app.use("/api/inventario", inventarioRoutes);
app.use("/api/mesas", mesasRoutes);

app.use("/panel", express.static(path.join(__dirname, "..", "public", "panel")));

app.get("/api/salud", (req, res) => res.json({ estado: "ok" }));

app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada." }));

module.exports = app;
