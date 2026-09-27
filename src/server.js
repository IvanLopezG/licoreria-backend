const app = require("./app");
const { logger } = require("./utils/logger");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info({ puerto: Number(PORT), panel: `http://localhost:${PORT}/panel/login.html` }, "servidor escuchando");
});
