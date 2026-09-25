const movimientoService = require("../services/movimientoInventarioService");
const { aCSV } = require("../utils/csv");

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
  try {
    const movimiento = await movimientoService.registrarEntrada(req.body, req.usuario.id_usuario);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "movimientos_inventario", id_entidad: movimiento.id_movimiento };

    return res.status(201).json(movimiento);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

async function salida(req, res) {
  try {
    const movimiento = await movimientoService.registrarSalida(req.body, req.usuario.id_usuario);

    req.auditoria = { accion: "crear", entidad: "movimientos_inventario", id_entidad: movimiento.id_movimiento };

    return res.status(201).json(movimiento);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

// US-19 (opcional): ?formato=csv reutiliza el mismo filtro que el JSON normal.
async function historial(req, res) {
  const { id_producto, desde, hasta, id_usuario, formato } = req.query;
  const movimientos = await movimientoService.historial({ id_producto, desde, hasta, id_usuario });

  if (formato === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=reporte_movimientos.csv");
    return res.send(aCSV(movimientos, COLUMNAS_CSV));
  }

  return res.json(movimientos);
}

module.exports = { entrada, salida, historial };
