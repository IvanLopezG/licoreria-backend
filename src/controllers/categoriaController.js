const categoriaService = require("../services/categoriaService");

async function crear(req, res) {
  try {
    const nueva = await categoriaService.crearCategoria(req.body);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "categorias", id_entidad: nueva.id_categoria };

    return res.status(201).json(nueva);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function listar(req, res) {
  return res.json(await categoriaService.listarCategorias());
}

module.exports = { crear, listar };
