const movimientoService = require("../services/movimientoInventarioService");
const { enviarCSV } = require("../utils/csv");

const COLUMNAS_CSV = [
  { titulo: "id_movimiento", campo: "id_movimiento" },
  { titulo: "producto", campo: "producto_nombre" },
  { titulo: "tipo", campo: "tipo" },
  { titulo: "motivo", campo: "motivo" },
  { titulo: "cantidad", campo: "cantidad" },
  { titulo: "usuario", campo: "usuario_nombre" },
  { titulo: "fecha_hora", campo: "fecha_hora" },
];

async function entrada(req, res) {
  const movimiento = await movimientoService.registrarEntrada(req.body, req.usuario.id_usuario);

  // El middleware de auditoría escribe el registro al ver este campo.
  req.auditoria = { accion: "crear", entidad: "movimientos_inventario", id_entidad: movimiento.id_movimiento };

  return res.status(201).json(movimiento);
}

async function salida(req, res) {
  const movimiento = await movimientoService.registrarSalida(req.body, req.usuario.id_usuario);

  req.auditoria = { accion: "crear", entidad: "movimientos_inventario", id_entidad: movimiento.id_movimiento };

  return res.status(201).json(movimiento);
}

// US-19 (opcional): ?formato=csv reutiliza el mismo filtro que el JSON normal.
// &excel=1 (opcional, lo usa el panel): BOM, ";" y CRLF para Excel en Colombia;
// sin él, el CSV de siempre.
async function historial(req, res) {
  const { id_producto, desde, hasta, id_usuario, formato, excel } = req.query;
  const movimientos = await movimientoService.historial({ id_producto, desde, hasta, id_usuario });

  if (formato === "csv") {
    return enviarCSV(res, movimientos, COLUMNAS_CSV, { archivo: "reporte_movimientos.csv", excel: excel === "1" });
  }

  return res.json(movimientos);
}

module.exports = { entrada, salida, historial };
