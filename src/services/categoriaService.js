const categoriaModel = require("../models/categoriaModel");

function crearCategoria({ nombre }) {
  if (!nombre) {
    const err = new Error("nombre es obligatorio.");
    err.status = 400;
    throw err;
  }

  if (categoriaModel.buscarPorNombre(nombre)) {
    const err = new Error("Ya existe una categoría con ese nombre.");
    err.status = 409;
    throw err;
  }

  return categoriaModel.crear({ nombre });
}

function listarCategorias() {
  return categoriaModel.listar();
}

module.exports = { crearCategoria, listarCategorias };
