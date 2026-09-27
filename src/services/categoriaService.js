const categoriaModel = require("../models/categoriaModel");
const { ErrorConflicto, ErrorValidacion } = require("../utils/errores");

async function crearCategoria({ nombre }) {
  if (!nombre) {
    throw new ErrorValidacion("nombre es obligatorio.");
  }

  if (await categoriaModel.buscarPorNombre(nombre)) {
    throw new ErrorConflicto("Ya existe una categoría con ese nombre.");
  }

  return categoriaModel.crear({ nombre });
}

function listarCategorias() {
  return categoriaModel.listar();
}

module.exports = { crearCategoria, listarCategorias };
