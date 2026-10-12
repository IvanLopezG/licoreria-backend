const alertaStockService = require("../services/alertaStockService");

// GET /api/alertas-stock[?ventana_dias=30&cobertura_alerta_dias=5&dias_objetivo=14]
async function listar(req, res) {
  const { ventana_dias, cobertura_alerta_dias, dias_objetivo } = req.query;
  const alertas = await alertaStockService.listar({ ventana_dias, cobertura_alerta_dias, dias_objetivo });
  return res.json(alertas);
}

module.exports = { listar };
