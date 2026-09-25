const ventaService = require("../services/ventaService");
const { aCSV } = require("../utils/csv");

const COLUMNAS_CSV = [
  { titulo: "id_venta", campo: "id_venta" },
  { titulo: "tipo", campo: "tipo" },
  { titulo: "mesa_numero", campo: "mesa_numero" },
  { titulo: "usuario", campo: "usuario_nombre" },
  { titulo: "total", campo: "total" },
  { titulo: "estado", campo: "estado" },
  { titulo: "factura", campo: "numero_factura" },
  { titulo: "fecha_hora", campo: "fecha_hora" },
];

async function crearMostrador(req, res) {
  try {
    const venta = await ventaService.crearVentaMostrador(req.body, req.usuario.id_usuario);

    // El middleware de auditoría escribe el registro al ver este campo.
    req.auditoria = { accion: "crear", entidad: "ventas", id_entidad: venta.id_venta };

    return res.status(201).json(venta);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

// US-19 (opcional): ?formato=csv reutiliza el mismo filtro que el JSON normal.
async function listar(req, res) {
  const { desde, hasta, tipo, formato } = req.query;
  const incluir_anuladas = req.query.incluir_anuladas === "true";
  const ventas = await ventaService.listarVentas({ desde, hasta, tipo, incluir_anuladas });

  if (formato === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=reporte_ventas.csv");
    return res.send(aCSV(ventas, COLUMNAS_CSV));
  }

  return res.json(ventas);
}

module.exports = { crearMostrador, listar };
