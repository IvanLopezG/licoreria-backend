const reporteService = require("../services/reporteService");

// GET /api/reportes?periodo=dia|semana|mes|anio[&fecha=AAAA-MM-DD]
async function porPeriodo(req, res) {
  const { periodo, fecha } = req.query;
  const reporte = await reporteService.porPeriodo({ periodo, fecha });
  return res.json(reporte);
}

module.exports = { porPeriodo };
