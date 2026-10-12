# Licorería — Gestión de Inventario y Ventas por Mesa

Proyecto de grado de Ivan A. Lopez Panesso (532674), Ing. Sistemas UPB Bucaramanga.
Negocio real (licorería del papá del estudiante). 8 semanas, un solo desarrollador,
Scrumban: 4 sprints de 2 semanas, cada uno con entrega funcional incremental.

## Documentación completa del proyecto
Especificación de Requerimientos, Project Charter, EDT, Plan Integrado y Backlog
Priorizado ya existen (fuera de este repo). Este archivo resume lo que el código
necesita de ellos; no hace falta releerlos para trabajar, pero son la fuente de
verdad si algo aquí queda ambiguo.

## Stack y arquitectura (ya implementados en Sprint 1, no cambiar sin razón)
- Node.js + Express, arquitectura en capas: `rutas → controladores → servicios → modelos → Postgres`.
- **Postgres en Supabase** con `pg` (un `Pool`, `DATABASE_URL` del Session pooler, SSL),
  `bcryptjs` (hash de contraseñas), `jsonwebtoken` (auth). Antes era `node:sqlite`; la
  migración mantuvo los JSON idénticos (ver README, "Notas de la migración").
- Todo el acceso a datos es async/await con placeholders `$1, $2`. `db.js` expone
  `uno`, `todos`, `ejecutar`, `filtros()` (WHERE dinámico con fechas) y
  `conTransaccion(fn)`: un solo client del pool con `BEGIN`/`COMMIT`/`ROLLBACK`,
  liberado en `finally`. Toda operación multi-paso atómica (ajustar `stock_actual` +
  registrar en `movimientos_inventario`, cierre de cuenta US-14, descuento de
  inventario US-16, facturación, anulación) va dentro de `conTransaccion`, y cada
  función de modelo que participa recibe ese client como último parámetro `cx`.
- Tipos: ids/cantidades `integer`, dinero de venta `double precision`, fechas
  `timestamp(0)` en UTC (salen como texto "YYYY-MM-DD HH:MM:SS"), banderas 0/1 en
  `integer`. Un `COUNT`/`SUM` devuelve `bigint`: `db.js` lo convierte a número.
- Antes de cambiar una consulta, correr `scripts/escenario-api.js` contra una base
  vacía y `scripts/comparar-muestras.js sqlite <carpeta>`: la app Android depende de
  estos JSON.
- Middlewares en `src/middlewares/`: `auth.js` (verifica JWT), `roles.js` (RBAC por rol),
  `auditoria.js` (escribe en `log_auditoria` automáticamente cuando un controlador
  fija `req.auditoria = { accion, entidad, id_entidad }` — no lo hagas manualmente
  en el servicio, usa ese patrón), `manejoErrores.js` (único lugar donde un error se vuelve respuesta
  HTTP) y `registroPeticiones.js` (log de cada petición). Ver la sección **Manejo de errores** (incluye logging): los
  servicios lanzan un error de `utils/errores.js`, nunca `res.status(...)` ni `err.status = N` a mano.
- Esquema completo (12 tablas) ya está en `src/db/schema.sql`. Si un sprint necesita
  un campo que no está ahí, agrégalo al schema, no lo improvises en el código.
- Frontend: `public/catalogo` (cliente, sin login, vía QR — aún no existe, es de Sprint 3)
  y `public/panel` (mesero/cajero/admin, protegido por JWT).
- Sin WebSockets en ningún módulo: RF-13 y RF-14b se resuelven con polling.

## Reglas de negocio ya decididas (ver sección 4 del doc de modelo de datos)
- `VENTA_DETALLE` es la única fuente de líneas vendidas, tanto para venta por mesa
  (consolidando `PEDIDO_DETALLE` al cerrar cuenta) como para venta de mostrador
  (capturada directo). El descuento de inventario (RF-16) y los reportes (RF-17)
  siempre leen de `VENTA_DETALLE`, nunca ramifiquen la lógica según el tipo de venta.
- `precio_unitario` se copia en `PEDIDO_DETALLE` y `VENTA_DETALLE` al momento de la
  operación — es deliberado, no lo normalices quitando la columna.
- El QR de mesa usa `codigo_qr_token` (aleatorio), nunca el `id_mesa` interno.
- `LOG_AUDITORIA` (genérico) es aparte del Kardex `MOVIMIENTOS_INVENTARIO`
  (específico de inventario) — no fusionarlos.

## Convenciones
- Todo en español: nombres de tabla/campo, variables, comentarios, mensajes de error.
- Nombres de campo exactamente como en `schema.sql` — no renombrar por preferencia propia.
- Cada historia de usuario tiene criterios de aceptación (abajo). Al terminar una,
  pruébala tú mismo contra esos criterios con `curl` antes de darla por hecha —
  no basta con que el código "se vea bien".
- Respeta las dependencias entre historias listadas abajo: no implementes una antes
  que sus dependencias, aunque parezca más rápida.
- Un commit por historia de usuario terminada (es la mitigación de riesgo ya definida
  para "pérdida de avances de código").

## Estado actual
**Sprint 1 — Auth y Usuarios: COMPLETO.** US-01, US-02, US-03 implementadas y
probadas end-to-end (login, roles, bitácora automática).
**Sprint 2 — Inventario: COMPLETO.** US-04 a US-09 implementadas y probadas.
**Sprint 3 — Mesas y Pedidos por QR: COMPLETO.** US-10 a US-14 implementadas y
probadas end-to-end (QR por mesa, catálogo público, autopedido, panel de
pedidos con polling, cierre de cuenta transaccional).
**Sprint 4 — Venta sin Mesa y Reportes: COMPLETO.** US-15 a US-19 implementadas
y probadas, incluyendo las dos opcionales (US-14b, US-19). El descuento de
inventario (US-16) quedó dentro de la misma transacción que crea la venta,
tanto en la venta de mostrador como en el cierre de cuenta por mesa. No queda
ninguna historia pendiente del Backlog Priorizado. Ver `README.md`.
**Facturación (comprobante interno, sin DIAN): COMPLETA.** Cada venta emite su
factura en la misma transacción (tablas `emisor`, `secuencias_factura`, `facturas`,
`factura_items`; tasas IVA/INC por producto; PDF con pdfkit). Tarifas pendientes de
validar con contador. Ver sección *Facturación* del `README.md`.
**Base de factura electrónica DIAN: COMPLETA (sin transmisión).** `emisor.modo_facturacion`
('interno' por defecto, no cambia nada). En 'electronica_dian': CUFE (SHA-384, `utils/cufe.js`,
`npm test`), QR, XML UBL 2.1 en `facturas_electronicas` como 'pendiente', PDF con leyenda de
"pendiente de validación". `responsable_iva/inc` del emisor sí afectan el cálculo. La transmisión
(proveedor tecnológico) y la nota crédito quedan pendientes. Ver sección *Factura electrónica* del `README.md`.
**Productos y proveedores ampliados (panel web): COMPLETO.** Migración aditiva al final de
`schema.sql` (todo opcional en la API; si un campo no llega, se conserva):
- `productos`: `costo` (>= 0), `codigo_barras` (código de barras / SKU, único cuando no es
  NULL, índice parcial; duplicado → 409), `marca`, `volumen_ml` (entero > 0), `grado_alcohol`
  (0-100; se borra si `es_bebida_alcoholica` = 0), `descripcion` (máx. 300), `activo` (0/1,
  defecto 1). **Inactivo:** no sale en `GET /api/catalogo/:token`, y el autopedido por QR y la
  venta de mostrador lo rechazan (400); sigue en ventas, facturas y movimientos.
- `proveedores`: `nit` + `dv` (DV calculado por el servidor con `utils/nit.js`, igual que el
  emisor), `telefono`, `correo` (formato validado), `direccion`, `ciudad`, `condicion_pago`
  (`contado`/`credito`), `dias_credito` (solo con crédito), `notas`, `activo` (defecto 1).
  `contacto` se conserva y el panel la muestra como "Persona de contacto".
  Endpoints nuevos: `PUT /api/proveedores/:id` (parcial) y
  `DELETE /api/proveedores/:id/productos/:id_producto` (quita la asociación), auditados.
- UI: login rediseñado (pantalla propia sin barra lateral, "Ingresando…", aviso si Render
  tarda > 4 s). El login solo muestra el formulario: tras ingresar va a Pedidos, y si al abrirlo ya
  hay token lo valida con `GET /api/auth/me` (200 → Pedidos; 401 → limpia la sesión y queda el
  formulario; sin conexión → formulario y aviso, sin redirigir). No muestra usuario ni rol. "Cerrar
  sesión" está al final del menú lateral de todas las páginas (lo agrega `menu.js`, que también
  quita el enlace "Login" cuando hay sesión); títulos sin "Sprint N"; productos y proveedores con
  formulario por secciones, buscador (nombre/SKU, nombre/NIT) y Editar; margen
  (precio − costo) / precio en el listado; los selectores de venta de mostrador y de entradas
  de inventario ocultan productos y proveedores inactivos.

**Tabla de productos en la pestaña Inventario (panel web): COMPLETA** (2026-10-09). Solo frontend
(`public/panel/inventario.html`, `panel.css`); **la API no cambió**:
- **Orden de la página** (desde el 2026-10-11): tarjetas de resumen → Registrar entrada / Registrar salida (lado a
  lado) → "Productos en inventario" → Historial de movimientos. Solo se movió el bloque en el HTML; el contenido, los
  estilos y el comportamiento de la tabla no cambiaron (se quitó `.tarjetas-inventario`, que solo separaba las tarjetas
  de la tabla cuando esta iba arriba). Verificado contra PGlite local con Chrome headless a 1366 y 390 px (sin desborde,
  tablas desplazables, búsqueda, filtro, orden, ambos "Exportar CSV" y refresco tras entrada y salida); `npm test` 59/59.
- "Productos en inventario": una fila por producto (activos e inactivos, estos con
  la insignia INACTIVO) con nombre + SKU, categoría, marca, unidad + ml, stock, umbral, estado, precio y
  costo. Datos de `GET /api/productos` (la misma petición que llena los selectores; permisos de siempre:
  administrador y cajero, el mesero ve "No tienes permiso…"). Se recarga tras cada entrada o salida.
- Buscador por nombre (sin tildes ni mayúsculas, mientras se escribe), filtro por categoría (las que tienen
  productos), orden al tocar cada encabezado (`aria-sort`; los vacíos, como marca o costo, siempre al final),
  "Cargando productos…", "No hay productos registrados." y "Ningún producto coincide…".
- **Estado de stock con el umbral que ya existía** (`umbral_alerta` por producto, `alerta_stock_bajo` =
  `stock_actual <= umbral_alerta`, calculado en `productoService`): **Agotado** si stock 0, **Stock bajo** si
  `alerta_stock_bajo`, si no **Disponible**. No se inventó ningún umbral.
- **No existía descarga de Excel** en la pestaña Inventario (ni en el backend ni en la app Android). Los
  botones de exportar se agregaron después (ver *Exportar CSV en Inventario*, abajo).
- Celular: `inventario.html` es la **única** página del panel con `<meta name="viewport">`. La media query
  `max-width: 720px` de `panel.css` (menú lateral arriba y desplazable, márgenes menores) solo la activan las
  páginas con viewport; las demás se siguen viendo a 980 px como antes. Para adaptar otra página: agregarle
  el meta y envolver sus tablas en `.tabla-desplazable`.
- Verificado contra Postgres local desechable (PGlite, `PG_POOL_MAX=1`) con Chrome headless a 1366 px y
  390 px: búsqueda, filtro, orden, estados, refresco tras salida, escape de HTML en nombres, sin desborde
  horizontal en 390 px. `npm test` 52/52.

**Exportar CSV en Inventario (panel web): COMPLETO** (2026-10-09). Dos botones "Exportar CSV" (`.btn`
secundario, deshabilitado y con `title` explicativo si no hay filas):
- **Productos:** se genera en el navegador (`public/panel/csv.js`, objeto `Csv`) con los datos ya cargados, sin
  petición: exactamente lo visible (búsqueda, categoría y orden). Columnas: Producto, Código de barras / SKU,
  Categoría, Marca, Unidad, Volumen (ml), Stock, Umbral, Estado, Precio, Costo, Activo (Sí/No). Archivo
  `inventario-productos-AAAA-MM-DD.csv` (fecha local del navegador).
- **Movimientos:** `GET /api/inventario/movimientos?formato=csv&excel=1` con los filtros del último "Filtrar"
  (lo que se ve en la tabla, no lo escrito sin aplicar). El token va en `Authorization` (no hay cookie), así
  que se descarga con `Api.pedir(..., { respuesta: "blob" })` y se guarda como Blob. Archivo
  `inventario-movimientos-AAAA-MM-DD.csv`. Permisos de siempre: administrador y cajero (mesero 403).
- **Formato para Excel en Colombia (ambos archivos, mismo criterio):** el CSV de siempre usaba coma, que Excel
  con configuración regional de Colombia (separador de lista `;`, coma decimal) abre todo en una sola columna.
  Ahora: BOM UTF-8, separador `;`, CRLF y comillas para valores con `;`, `,`, comillas o saltos de línea.
  En el servidor es **opcional**: `&excel=1`; **sin él el CSV es el de siempre byte a byte** (coma, `\n`, sin
  BOM). En productos, además: precios con coma decimal (`45000,5`; con punto Excel los toma como miles) y el
  código de barras numérico como `="0770…"` (si no, Excel lo muestra como `7,702E+12` y quita los ceros a la
  izquierda). Ventas usa el mismo formato desde el 2026-10-09 (ver *CSV de Ventas para Excel*, abajo).
- **Verificado** contra Postgres local desechable (PGlite) y Chrome headless (1366 y 390 px): exportación con y
  sin filtros, orden, botón deshabilitado sin filas, sin desborde en celular, cajero 200 / mesero 403 / sin token
  401. **Abiertos en Excel 16** (COM con `Local=true`, igual que doble clic; configuración regional con `;` y coma
  decimal): columnas separadas, tildes y ñ correctas, comillas/`;`/saltos de línea dentro de su celda, precios
  como número, SKU `0770200400300` como texto, `fecha_hora` como fecha. `escenario-api.js` antes/después: 136
  respuestas, solo cambia el `token_sesion` aleatorio. `npm test` 54/54 (`test/csv.test.js` nuevo).

**CSV de Ventas para Excel y formato común (panel web y API): COMPLETO** (2026-10-09).
- **Una sola definición del formato Excel:** `public/panel/csv.js` (objeto `Csv`: `generar`, `escapar`, `numero`,
  `codigo`, `nombreConFecha`, `descargar`) se carga en el panel con `<script>` y en el servidor con `require`
  (al final hace `module.exports = Csv` si existe `module`). `src/utils/csv.js` lo usa en el modo Excel:
  `aCSV(filas, columnas, { excel })`, donde cada columna puede declarar `excel: "numero"` (coma decimal) o
  `excel: "codigo"` (solo dígitos → `="…"`, texto), y `enviarCSV(res, filas, columnas, { archivo, excel })` pone los
  encabezados de siempre (lo usan `ventaController` y `movimientoInventarioController`). El modo por defecto
  (coma) sigue escrito aparte en `utils/csv.js` y no cambió. Para un CSV nuevo: columnas con `excel` donde haga
  falta, `enviarCSV` y en el panel `?formato=csv&excel=1` + `Csv.descargar(blob, Csv.nombreConFecha("…"))`.
- **`GET /api/ventas?formato=csv&excel=1`** (opcional): BOM, `;`, CRLF, escape de `;`/`,`/comillas/saltos de línea,
  `total` con coma decimal y `factura` como texto si es solo dígitos (sin prefijo la numeración sale `1001`, `0001`…).
  Mismos filtros (`desde`, `hasta`, `tipo`, `incluir_anuladas`) y encabezados HTTP. Sin `excel=1` (u otro valor)
  el CSV de siempre; JSON sin cambios.
- **Panel (`ventas.html`):** "Exportar CSV" pide `excel=1` con los filtros del último "Filtrar" (lo visible, igual
  que en Inventario), descarga `ventas-AAAA-MM-DD.csv` por fetch + Blob y queda deshabilitado sin ventas. Mismos
  permisos (administrador y cajero) y mismo aspecto.
- **Verificado** (Postgres local desechable, PGlite): `npm test` 59/59 (`test/ventasCsv.test.js`: CSV de siempre
  exacto, modo Excel exacto, otro valor de `excel` = CSV de siempre, mismos filtros que el JSON, JSON intacto;
  `test/csv.test.js` igual que antes). `aCSV` viejo vs nuevo: idéntico en ambos modos (196 combinaciones).
  `escenario-api.js` antes/después: 136 respuestas iguales salvo el `token_sesion` aleatorio; los CSV de ventas y
  movimientos con las mismas líneas, encabezados, sin BOM ni `\r` (el orden de filas del mismo segundo varía entre
  corridas también con el código anterior: `ORDER BY fecha_hora DESC, id` con resolución de segundos). Chrome
  headless: filtros, deshabilitado, token en encabezado. **Excel 16** (configuración con `;` y coma decimal):
  8 columnas, tildes y ñ, `Begoña Peñaranda, caja; turno "noche"` en una celda, total numérico (`7601,5`, se
  puede sumar), factura como texto y `fecha_hora` como fecha.
- **Pendientes de exportación (no se modificaron):**
  - **Fechas en UTC** en los tres CSV (ventas, movimientos y productos no tiene fechas) y en las tablas del panel:
    `fecha_hora` sale como se guarda (UTC, 5 horas adelante de Colombia); una venta de las 8:00 p. m. aparece
    a la 1:00 a. m. del día siguiente. El CSV coincide con lo que muestra el panel; corregirlo es convertir a hora
    de Colombia en ambos (p. ej. con `utils/fechaColombia.js`) y revisar los filtros `desde`/`hasta`, que también
    comparan en UTC.
  - **CSV sin `excel=1`** (coma) sigue disponible en la API para quien lo use fuera del panel; en Excel con
    configuración de Colombia se abre en una sola columna. Ningún botón del panel lo usa ya.
  - No hay otros CSV ni exportaciones con este problema: el resto de descargas del panel son el PDF y el XML de
    la factura. La bitácora de auditoría y el reporte de movimientos por usuario (US-18, `?id_usuario=`) no
    tienen botón de exportar.

**Reportes por periodo (`GET /api/reportes`, API): COMPLETO** (2026-10-11). Ver la sección *Reportes por periodo*
más abajo. Sin cambios de esquema. Pantalla "Reportes" en la app Android (app `e9e3de7`) y en el panel web
(`reportes.html`, 2026-10-11).

**Alertas de stock (`GET /api/alertas-stock`, API): COMPLETO** (2026-10-11). Ver la sección *Alertas de stock* más
abajo. Sin cambios de esquema. Pantalla "Alertas de stock" con contador en el menú en la app Android (app `c014e48`,
`115a2bf`) y en el panel web (`alertas.html` + contador en el menú, 2026-10-11). Sin notificaciones push.

**Chatbot del personal (`POST /api/chatbot`, `GET /api/chatbot/preguntas`, API): COMPLETO** (2026-10-11). Ver la
sección *Chatbot para el personal* más abajo. Gemini opcional (`GEMINI_API_KEY`); sin clave responde en modo básico.
Sin cambios de esquema ni dependencias nuevas. Pantalla "Asistente" en la app Android (app `2c525ca`) y en el panel web
(`asistente.html`, 2026-10-11).

**Panel web: Reportes, Alertas de stock y Asistente: COMPLETO** (2026-10-11). Ver la sección *Panel web: Reportes,
Alertas de stock y Asistente* más abajo. Solo frontend (`public/panel/`); la API no cambió.

**Manejo de errores central y logging con Pino: COMPLETO.** Ver la sección *Manejo de errores* más abajo.

**Sesiones de mesa en el catálogo QR (factura y estado de pedidos en el celular): COMPLETA.** Ver la
sección *Sesiones de mesa en el catálogo QR* más abajo.

**Resolución de numeración (panel web, solo administrador): COMPLETA.** Cada fila de
`secuencias_factura` es una resolución (se agregaron `vigencia_desde` y `fecha_registro`); solo una
activa. `src/services/resolucionService.js`, endpoints en `emisor.routes.js`:
- `GET /api/emisor/resolucion` → `{activa, historicas}` con prefijo, número y fecha de resolución, rango,
  consecutivo actual (último emitido), siguiente número, números que quedan, vigencia, días para vencer,
  facturas emitidas, `editable` y `alertas` (roja: vencida o agotada; amarilla: < 10 % del rango,
  < 30 días de vigencia, sin clave técnica o sin resolución DIAN). **La clave técnica nunca se devuelve**:
  solo `clave_tecnica_configurada`.
- `PUT` edita la activa **solo si aún no emitió facturas** (409 si ya emitió): las facturas NO copian
  número, fecha ni rango de la resolución (solo `id_secuencia` y `numero_completo`; el PDF los lee con
  JOIN), así que editarla cambiaría el historial. `POST` registra una nueva, que queda activa, y la
  anterior pasa a histórica intacta.
- Reglas: prefijo de 1 a 4 letras o números (opcional), número de resolución solo dígitos, fechas
  válidas, rango desde ≤ hasta, vigencia hasta > desde y no vencida; el rango debe empezar después del
  último número emitido con el mismo prefijo en cualquier resolución (409: no se reusa ni retrocede).
  La clave técnica solo se guarda si se escribe; vacía al editar conserva la guardada (una resolución
  nueva no hereda la clave de la anterior: la DIAN entrega una por resolución).
- Bitácora: `log_auditoria.detalle` (columna nueva, opcional en `req.auditoria`) guarda qué campos
  cambiaron, nunca valores (la clave técnica solo como nombre de campo).
- Panel (`negocio.html`, página solo para el administrador): resumen, avisos amarillo/rojo, formulario con
  confirmación "Esta acción queda registrada en la bitácora", clave técnica como contraseña ("Configurada")
  e historial de resoluciones. Pruebas: `test/resolucion.test.js`.
- **Al facturar con la resolución vencida o agotada:** se bloquea. `facturaModel.tomarSiguienteNumero`
  lanza error, la transacción revierte venta, stock y factura (en cierre de mesa, la mesa sigue ocupada), y
  la API responde **409** con "La resolución de numeración de facturas está vencida." o "Se agotó el rango
  de numeración de facturas.".
- **Vigencia en hora de Colombia:** toda comparación con `vigencia_hasta` (al facturar, al registrar una
  resolución, `dias_para_vencer` y avisos del panel) usa `utils/fechaColombia.js` (`hoyColombia()`, UTC-5
  fijo, sin librerías): el último día de vigencia factura hasta las 11:59 p. m. hora de Colombia.
  Pruebas: `test/vigenciaResolucion.test.js`.

## Sesiones de mesa en el catálogo QR (factura y estado de pedidos en el celular)
Auditoría (Fase 0) del 2026-09-27 sobre `9a46ae9`, desviaciones e implementación.
Objetivo: el cliente ve en su pestaña del catálogo el estado de sus pedidos y su factura al cerrar la
cuenta, y el siguiente cliente de la misma mesa ve el catálogo limpio.

**Hallazgos del código real:**
- (a) **Token de mesa:** `mesaModel.generarToken` (`crypto.randomBytes(16)`, hex) al crear la mesa; se guarda
  en claro en `mesas.codigo_qr_token` (UNIQUE), nunca expira ni rota. `mesaService.generarQR` arma
  `/catalogo/index.html?token=…`. El catálogo (`public/catalogo/index.html`) lo lee de la URL y lo pone en la
  ruta: `GET /api/catalogo/:token`, `POST /api/catalogo/:token/pedidos`, `GET /api/catalogo/:token/pedidos`.
  El backend (`catalogoService.buscarMesaPorToken`) solo verifica que exista (404 "Mesa no encontrada.").
  No hay limitación de intentos en ninguna ruta del proyecto.
- (b) **Estado de la mesa:** `mesas.estado` (`libre`/`ocupada`). Lo cambian: `pedidoModel.crear` → ocupada
  (misma transacción que el pedido); `ventaModel.cerrarCuentaMesa` → libre; `facturaModel.anular` con
  `reabrir_pedidos` → ocupada. Cancelar un pedido (`pedidoModel.cancelar`) no toca la mesa. Android usa
  `GET/POST /api/mesas`, `GET /api/mesas/:id/qr`, `GET /api/pedidos`, `PUT /api/pedidos/:id/entregado`,
  `DELETE /api/pedidos/:id`, `POST /api/mesas/:id/cerrar-cuenta`, `GET /api/facturas/:id/pdf`,
  `POST /api/facturas/:id/anular` y `POST/GET /api/ventas`; **ningún endpoint del catálogo**. Parsea con
  `ignoreUnknownKeys = true` (campos nuevos no la rompen).
- (c) **Agrupación de pedidos:** la cuenta abierta de una mesa = sus pedidos con `id_venta IS NULL`.
  `ventaModel.cerrarCuentaMesa` los toma `FOR UPDATE`, copia sus líneas a `venta_detalle`, descuenta stock,
  los marca entregados con `id_venta`, libera la mesa y llama a `facturaModel.emitir`, todo en una
  `conTransaccion`. **No existe endpoint para que el mesero cree pedidos**: todo pedido entra por el QR.
- (d) **Historial público:** `GET /api/catalogo/:token/pedidos` devuelve los pedidos abiertos de la mesa
  (ids internos, ítems, precios, horas) a cualquiera que tenga el token del QR, que está impreso en la mesa y
  no rota: una foto del QR basta para ver la cuenta de los clientes siguientes. **Fuga de privacidad**
  (baja: no hay datos personales, sí consumos). Solo lo usa el catálogo; Android no.
- (e) **Cierre, PDF y anulación:** `generarPdfFactura(factura)` (`utils/facturaPdf.js`, 80 mm) recibe el
  objeto de `facturaModel.buscarPorId` y pinta datos completos del cliente. `facturaModel.anular` (una
  transacción): factura y venta → anuladas, devuelve stock y, con `reabrir_pedidos` (solo venta de mesa, 409
  si la mesa ya tiene pedidos abiertos), pone `id_venta = NULL` en los pedidos y la mesa ocupada.
- (f) **Esquema:** un solo `src/db/schema.sql` idempotente (`CREATE … IF NOT EXISTS`, `ALTER … ADD COLUMN IF
  NOT EXISTS`), aplicado completo por `db.inicializarEsquema` en cada `npm run seed` / `npm start` (o sea, en
  cada despliegue de Render contra Supabase). No hay tabla de versiones de migración: todo lo nuevo debe
  poder ejecutarse muchas veces. SQL estándar de Postgres, compatible con Supabase.

**Conclusión:** el diseño acordado es viable y seguro. **Desviaciones** (motivo entre paréntesis):
1. Nombres `id_sesion`, `id_mesa`, `id_factura`, `pedidos.id_sesion` y tabla `mesa_sesion_tokens` en vez de
   `id`, `mesa_id`, `factura_id`, `sesion_id` (convención del esquema: `id_<entidad>`).
2. Estado extra de sesión `cancelada`: si se cancelan todos los pedidos abiertos de una sesión, se cierra
   sin factura (si no, el siguiente cliente entraría en la sesión del anterior porque la mesa sigue
   ocupada). La mesa no cambia (Android igual que antes).
3. "Pedidos tomados por el mesero" no existen en el backend (hallazgo c). La limitación queda así: si el
   pedido se hace desde un celular que no es del cliente (p. ej. el del mesero), el token queda en ese celular.
4. Anulación **sin** reapertura: la sesión sigue cerrada, `revision++`, y el cliente ve "La factura fue
   anulada" sin datos ni PDF (el diseño solo cubría la anulación con reapertura).
5. Anulación con reapertura de una venta anterior a esta migración (sin sesión): se crea una sesión nueva
   sin tokens para los pedidos reabiertos (nadie la ve desde el público).
6. `GET /api/catalogo/:token/pedidos` se conserva (mismo formato, arreglo) pero sin token de sesión devuelve
   `[]`; con un token válido de la sesión activa de esa mesa, los pedidos de esa sesión (hallazgo d).
7. Limitación de intentos: no había nada; se agrega un limitador en memoria por IP (sin dependencias; se
   reinicia con el proceso) y `app.set("trust proxy", 1)` para ver la IP real detrás del proxy de Render.
8. `db.js` acepta `PGSSLMODE=disable` para probar contra un Postgres local sin SSL (por defecto, igual que antes).

**Implementación (COMPLETA):**
- **Modelo** (final de `schema.sql`): `mesa_sesiones` (`id_sesion`, `id_mesa`, `estado` activa/cerrada/cancelada,
  `abierta_en`, `cerrada_en`, `revision`, `id_factura`, `reabierta`; índice único: una activa por mesa),
  `mesa_sesion_tokens` (`token_hash` SHA-256 único, `id_sesion`, `creado_en`, `revocado_en`) y
  `pedidos.id_sesion` (nulo en el historial previo). La migración deja en una sesión activa los pedidos abiertos
  existentes. Reversión: `scripts/revertir-sesiones-mesa.sql` (solo junto con volver el código atrás).
- **Ciclo de vida** (`models/mesaSesionModel.js`, siempre dentro de la transacción de la operación): el primer
  pedido de una ocupación abre la sesión (mesa `FOR UPDATE`); pedido nuevo, entregado y cancelado suben
  `revision`; cancelar todos los pedidos abiertos → `cancelada`; cierre de cuenta → `cerrada` con `id_factura`
  y `cerrada_en`, y la mesa libre; anulación con reapertura → `activa`, `reabierta = 1`, sin factura (pedidos
  reabiertos ligados a ella); sin reapertura → sigue cerrada, `revision++`. Una ocupación nueva siempre abre otra
  sesión: un token viejo nunca ve la sesión nueva.
- **Tokens:** `crypto.randomBytes(32)` en base64url, se entregan una sola vez como `token_sesion` (campo nuevo
  opcional) en `POST /api/catalogo/:token/pedidos` cuando el celular no manda un `X-Sesion-Token` válido de la
  sesión activa de esa mesa. Solo se guarda el hash; se busca por índice y se compara en tiempo constante.
  Varios celulares por sesión: cada uno que pidió ve la cuenta completa de la mesa; uno que no pidió, nada.
- **Endpoints públicos** (sin login, token solo en el encabezado `X-Sesion-Token`; en la URL se ignora → 401;
  todos con `Cache-Control: no-store`):
  - `GET /api/catalogo/sesion/estado` → `{estado, revision, mesa:{numero}, reabierta, pedidos:[{numero,
    fecha_hora, estado, items:[{producto, cantidad, precio_unitario}]}], total_pedidos, factura, factura_anulada,
    vence_en}`. `factura` (solo cerrada, vigente y emitida): título, número, fecha, emisor, cliente con documento
    enmascarado (`CC *******432`, sin correo), ítems, subtotal, IVA, INC, total, forma de pago, leyenda. Sin ids
    internos. `ETag: W/"<revision>-<estado>"`; `If-None-Match` igual → 304 sin cuerpo (una sola consulta).
  - `GET /api/catalogo/sesion/factura.pdf` → el PDF de 80 mm de siempre (datos completos del cliente);
    404 si la cuenta sigue abierta, 410 si la factura se anuló.
  - `POST /api/catalogo/sesion/listo` → revoca el token de ese celular (`{ok:true}`; otra vez → 410).
  - Códigos: 401 "Sesión no válida." si el token no existe o no llegó (no revela nada); 410 si se revocó, la
    sesión se canceló o venció. La factura sigue en el sistema; solo deja de verse desde el público.
  - `GET /api/catalogo/:token/pedidos` (formato de siempre): sin `X-Sesion-Token` de la sesión activa de esa
    mesa devuelve `[]`. El catálogo ya no lo usa.
- **Vencimiento:** `SESION_FACTURA_MINUTOS` (opcional, **30** por defecto; un valor inválido usa 30), contado desde
  `cerrada_en`. Sin cron: se valida en cada consulta.
- **Limitación de intentos** (`middlewares/limiteIntentos.js`, en memoria por IP, se reinicia con el proceso):
  30 respuestas 401/404 cada 10 min en `/api/catalogo/*`; 60 pedidos cada 5 min; 300 consultas de sesión por
  minuto (generoso: los celulares del local comparten la IP del wifi). Excedido → 429 con `Retry-After`.
  `app.set("trust proxy", 1)` para la IP real en Render.
- **Catálogo** (`public/catalogo/index.html`): guarda el token en `localStorage` con la clave
  `licoreria.sesion.<token del QR>`. Polling cada 5 s con la pestaña visible; tras 6 respuestas 304 seguidas,
  cada 15 s; vuelve a 5 s al cambiar algo; pausa con la pestaña oculta (Page Visibility API) y consulta de
  inmediato al volver; sin keep-alive. Muestra "En preparación"/"Entregado ✓", la factura con "Descargar PDF"
  (fetch con el encabezado) y "Listo", el aviso "La cuenta fue reabierta" y el de factura anulada. Con la cuenta
  cerrada oculta el menú hasta tocar "Listo". Con 410, 401, "Listo" o al vencer borra el token y el carrito y
  queda el catálogo limpio.
- **Limitación aceptada:** el token queda en el celular que hizo el pedido. Si el pedido lo hace el mesero
  desde su propio celular con el QR de la mesa (no hay otra forma de crear pedidos), el cliente no verá la factura
  en el suyo.
- **Pruebas:** `npm test` (`test/sesionCliente.test.js`) y
  `DATABASE_URL=<postgres local> PGSSLMODE=disable node scripts/prueba-sesiones-mesa.js` (se niega a correr si
  la base no es localhost). Verificado el 2026-09-27 contra PGlite local: 39/39 en `npm test`, 72/72 en el
  script, flujo en Chrome móvil (polling, pausa, 5→15 s, factura, PDF, Listo, reabierta, vencida), migración
  desde el esquema de `9a46ae9` con datos (dos veces y con reversión), y `escenario-api.js` antes/después:
  solo cambian `token_sesion` en los 3 pedidos y el historial por QR sin token (`[]`); el resto, idéntico.
  Verificación adicional del 2026-09-27 (casos 10 y 11 del script, 109/109 contra PGlite local): varios celulares
  en la misma mesa ven la cuenta completa, factura y PDF con sus propios tokens, y uno sin pedido no ve nada; el
  token de una sesión cerrada nunca ve la sesión nueva de la misma mesa (ni cambia su ETag), vence a 410 mientras
  la sesión nueva sigue normal, y si ese celular vuelve a pedir recibe un token nuevo.

## Manejo de errores
### Auditoría (Bloque 1, 2026-09-27, sobre `c8beaea`)
- **Controladores:** 13 archivos en `src/controllers/`, 47 handlers. **35 bloques `try/catch`**, todos con la
  misma forma `res.status(err.status || N).json({ error: err.message })`. El `N` por defecto varía: **400** en
  27 catch, **500** en 7 (`facturaController` pdf/xml/transmitir, `resolucionController.obtener` y los 3 de
  sesión del catálogo) y **401** en 1 (`authController.login`). 12 handlers no tienen `try` (listados,
  `auth.me`, `obtenerEmisor`). Además responden errores a mano: `authController.login` (400 sin datos),
  `middlewares/auth.js` (401 ×2), `middlewares/roles.js` (401, 403), `middlewares/limiteIntentos.js` (429 con
  `Retry-After`) y el 404 final de `app.js`. **No había middleware de errores de 4 argumentos.**
- **Dónde nace el código HTTP:** en los servicios y modelos, con `const err = new Error(m); err.status = N`
  (~55 sitios) o con helpers locales repetidos (`errorConEstado` ×4, `errorValidacion` ×2, `errorFacturacion` ×2,
  `errorNoElectronica`). **Todos los errores de negocio traen `status` explícito**. Los únicos `throw` sin
  estado son `utils/cufe.js` (ambiente inválido, falta la clave técnica: no alcanzables porque
  `facturaElectronicaModel` lo valida antes con 500) y `db.js` al arrancar sin `DATABASE_URL`.
- **Códigos y mensajes de negocio en uso (se conservan tal cual):**
  - 400 validación (p. ej. "precio debe ser mayor a 0.", "La mesa no está ocupada; no hay cuenta que cerrar.",
    "Solo quedan N unidades de X.", "Ya existe una mesa con ese número." — este es 400, no 409, y así se queda).
  - 401 "Token no proporcionado.", "Token inválido o expirado.", "No autenticado.", "Usuario o contraseña
    incorrectos.", "Sesión no válida." (token de sesión del catálogo).
  - 403 "No tienes permisos para esta acción. Rol requerido: …" (roles) y "Solo el administrador puede modificar
    los impuestos de un producto." (`productoService`).
  - 404 "… no encontrado/a." (producto, proveedor, mesa, pedido, factura, "Ruta no encontrada."), la factura no
    electrónica al pedir XML, y "La cuenta aún no se ha cerrado." (PDF del catálogo).
  - 409 SKU duplicado, usuario y categoría duplicados, resolución vencida o rango agotado, factura ya anulada,
    factura electrónica no anulable, reabrir con la mesa ocupada, resolución con facturas no editable, rango que
    retrocede.
  - 410 sesión del catálogo vencida/revocada/cancelada y factura anulada en el PDF del catálogo.
  - 429 limitador del catálogo. 501 transmisión a la DIAN.
  - 500 **intencionales** con mensaje útil para el personal: "No hay una secuencia de facturación activa.", "Faltan
    los datos del emisor de la factura.", "No se pudo reservar el número de factura.", "La secuencia de
    facturación activa no tiene clave técnica de la DIAN."
- **Errores inesperados hoy (fallas reales, no de negocio):** con la base caída, `GET /api/productos/1` responde
  **400** `{"error":"connect ECONNREFUSED …"}` y el login **401** con ese mismo texto (el mensaje crudo de pg, con
  código de cliente). Un handler sin `try` o un JSON mal formado caen en el manejador por defecto de Express 5:
  **HTML con el stack completo** (rutas del servidor incluidas), no JSON.
- **Formato que consumen los clientes:** idéntico en ambos: `{"error": "mensaje"}`. El panel web (`api.js`) lee
  `.error` y, si no hay JSON, usa un texto por código; la app Android (`ApiErrors.kt`, `ErrorResponse(error)`)
  hace lo mismo con `ignoreUnknownKeys`. El catálogo público usa el mismo `api.js` y, para la sesión, solo el
  código (401/410).
- **Validación:** no hay librería (ni express-validator, joi, zod ni yup); todo es validación manual en los
  servicios. Los únicos errores de terceros que hay que mapear son los de `express.json()` (body-parser:
  `type = "entity.parse.failed"` 400, `"entity.too.large"` 413) y los de `pg`.

### Decisión de diseño
Sí conviene una jerarquía propia: los códigos ya están bien decididos en la capa de negocio, pero se expresan
con un patrón manual repetido (~55 sitios y 9 helpers locales), y el valor por defecto de cada `catch` hace que
una falla real salga como 400/401 con el mensaje de pg. Con clases tipadas el servicio dice *qué* pasó
(`ErrorNoEncontrado`, `ErrorConflicto`…) y un único middleware decide la respuesta.
- Nombres en español (convención del repo) en `src/utils/errores.js`: base `ErrorApp(mensaje, status, codigo)` y
  una subclase por código en uso (400, 401, 403, 404, 409, 410, 429, 500 intencional, 501).
- **La forma de la respuesta no cambia:** siempre `{"error": "mensaje"}`; el `codigo` interno va solo al log.
- **Único cambio de comportamiento, deliberado:** un error que *no* es `ErrorApp` (pg, bug) pasa a ser **500**
  con mensaje genérico en español, en vez de 400/401 con el texto crudo o HTML con stack. Los errores de
  body-parser conservan su código (400/413) con mensaje en español. Todos los códigos y mensajes de negocio
  listados arriba se conservan exactamente.
- Controladores sin `try/catch`: Express 5 pasa a `next(err)` el rechazo de un handler `async`, así que el
  handler solo hace `await` y el error llega al middleware central.

### Diseño final (implementado, 2026-09-27)
- **Jerarquía** (`src/utils/errores.js`): `ErrorApp(mensaje, status, codigo?)` y subclases
  `ErrorValidacion` 400, `ErrorNoAutenticado` 401, `ErrorPermiso` 403, `ErrorNoEncontrado` 404,
  `ErrorConflicto` 409, `ErrorNoDisponible` 410, `ErrorDemasiadosIntentos` 429 (`reintentarEn` → `Retry-After`),
  `ErrorInterno` 500 (falta configuración: emisor, secuencia, clave técnica) y `ErrorNoImplementado` 501.
  El `codigo` interno opcional solo va al log. **Regla:** servicios y modelos lanzan la clase que describe lo
  que pasó; controladores y middlewares no arman respuestas de error (los middlewares hacen `next(error)`).
- **Cómo se decide el código** (`middlewares/manejoErrores.js`, `clasificar`), en este orden:
  1. `ErrorApp` → su `status` y su mensaje, tal cual.
  2. Error 4xx de una librería que sigue `http-errors` (`expose: true`: body-parser, `express.static`) → su
     código, con mensaje en español ("El cuerpo de la petición no es un JSON válido.", "…demasiado grande.",
     o "La petición no es válida.").
  3. Cualquier otra cosa (pg, un bug, un `Error` suelto aunque traiga `status`) → **500**.
  Ruta inexistente → `rutaNoEncontrada` lanza `ErrorNoEncontrado("Ruta no encontrada.")`. `app.js` normaliza
  `req.body` a `{}` si no llega JSON, para que la validación responda su 400 y no un TypeError (500).
- **Formato:** siempre `{"error": "mensaje"}`, en panel, app Android y catálogo (sin campos nuevos, sin stack).
  - **Panel y app** (todo lo que no es `/api/catalogo`): 4xx y 5xx de `ErrorApp` con su mensaje (un
    `ErrorInterno` le dice al personal qué configurar); un 500 inesperado → "Ocurrió un error inesperado en el
    servidor. Inténtalo de nuevo en un momento."
  - **Catálogo público** (`/api/catalogo/*`): mismos códigos; 4xx de negocio iguales ("Solo quedan N unidades
    de X.", "Sesión no válida."…); **todo 500**, incluso `ErrorInterno`, → "Ocurrió un error, intenta de nuevo."
- **Cambios de comportamiento (solo en fallas no previstas; ningún caso de negocio cambió):** una falla de pg
  ya no sale como 400/401 con el texto de pg sino como 500 genérico; un handler que falla o un JSON mal
  formado ya no devuelven la página HTML de Express con el stack sino JSON. Verificado con `escenario-api.js`
  (136 respuestas idénticas a la línea base tras cada commit; solo varía el `token_sesion` aleatorio),
  `npm test` (52) y `scripts/prueba-sesiones-mesa.js` (109) contra PGlite local.

### Logging (Pino)
- `src/utils/logger.js` (`pino`); `pino-pretty` es **devDependency**. Sin `pino-http` (no aprobada): el log de
  peticiones es `middlewares/registroPeticiones.js`.
- **Qué se registra:** por petición, `info` "petición" con `metodo`, `ruta`, `status`, `ms`. Por error, desde el
  manejador central: 5xx en `error` "error del servidor" con `status`, `metodo`, `ruta`, `tipo`, `codigo`,
  `mensaje` y `stack`; 4xx en `warn` "error de la petición", igual pero sin stack. El stack nunca va en la
  respuesta. También: conexión inactiva de pg caída (`db.js`), fallo al escribir la bitácora, arranque.
- **Qué se redacta (nunca aparece en un log):** contraseñas, JWT, token de sesión del catálogo (`X-Sesion-Token`),
  token del QR de la mesa y clave técnica. Cuatro capas: (1) solo se registran campos elegidos, nunca cuerpos,
  encabezados ni query string; (2) `redact` de Pino por nombre (`password`, `token`, `token_sesion`,
  `clave_tecnica`, `authorization`, `x-sesion-token`, `cookie`…, hasta 4 niveles) → `[REDACTADO]`; (3) en
  rutas, mensajes y stacks se borran JWT y cadenas de 32+ caracteres, y la ruta del catálogo sale como
  `/api/catalogo/:token/...`; (4) en los errores, además, los valores exactos que trajo la petición en campos
  secretos (p. ej. una clave técnica corta repetida por una excepción). Pruebas: `test/logger.test.js`.
- **Producción vs. desarrollo:** en Render la salida no es una terminal → JSON crudo, una línea por evento
  (`level` numérico de Pino, `time` ISO). `pino-pretty` solo se usa si `NODE_ENV` no es `production` y la salida
  es una terminal o `LOG_PRETTY=1`; con `NODE_ENV=production` nunca, aunque esté instalado. `LOG_PRETTY=0` lo
  apaga. Nivel: `LOG_LEVEL` (por defecto `info`; bajo `node --test`, `silent`). dotenv va con `quiet: true`
  para que stdout sea solo JSON. Ninguna variable nueva es obligatoria en Render.

## Reportes por periodo (`GET /api/reportes`)
### Inspección (Paso 0, 2026-10-11, sobre `c617382`)
- **(a) Ventas:** `ventas` (`id_venta`, `tipo` mesa/mostrador, `id_mesa`, `id_usuario`, `total`, `fecha_hora`
  `timestamp(0)` en UTC, `estado` activa/anulada; las anuladas no se borran). El detalle por producto ya existe:
  `venta_detalle` (`id_venta`, `id_producto`, `cantidad`, `precio_unitario` copiado al vender), única fuente de
  líneas vendidas para mesa y mostrador. El nombre sale de `productos.nombre`.
- **(b) Movimientos:** `movimientos_inventario` (Kardex): `tipo` solo `entrada`/`salida` (CHECK) y `motivo` libre;
  en uso: entrada `compra` (con proveedor) y `anulacion` (devuelve stock de una venta anulada); salida `venta`
  (descuento automático al vender, con `id_venta`) y `ajuste` (salida manual). **No hay tipo "ajuste"**: un ajuste es
  una salida con motivo `ajuste`. `fecha_hora` igual que en ventas (UTC).
- **(c) Productos:** `stock_actual` y `umbral_alerta` (el "stock mínimo"; `alerta_stock_bajo` = `stock_actual <=
  umbral_alerta`, calculado en `productoService`), además de `activo`.
- **Conclusión:** no falta fecha ni detalle por producto; **no se agregó ninguna columna ni migración**.

### Implementación (COMPLETA, 2026-10-11)
`routes/reportes.routes.js` → `reporteController` → `reporteService` → `reporteModel` (5 consultas de agregación
en SQL, en paralelo) + `utils/periodoReporte.js` (rango del periodo, función pura). Solo lectura, sin bitácora.
- **`GET /api/reportes?periodo=dia|semana|mes|anio[&fecha=AAAA-MM-DD]`**, administrador y cajero (mesero 403, sin
  token 401). `periodo` falta o no es uno de esos cuatro (en minúscula, `anio` sin ñ) → 400 "periodo es obligatorio.
  Debe ser uno de: dia, semana, mes, anio."; `fecha` que no es una fecha real `AAAA-MM-DD` (p. ej. 2026-02-30) → 400
  "fecha debe ser una fecha válida con formato AAAA-MM-DD.".
- **Respuesta:** `{periodo, fecha_referencia, rango:{desde, hasta, zona_horaria:"America/Bogota"}, total_vendido,
  numero_ventas, ticket_promedio, top_productos:[{id_producto, nombre, unidades, total}] (10),
  productos_menos_vendidos:[igual] (5), movimientos_inventario:{entradas, salidas, ajustes} (cada uno
  {movimientos, unidades}), ventas_por_dia:[{fecha, total, numero_ventas}]}`. Dinero redondeado a 2 decimales.
- **Decisiones ante ambigüedad (la opción más conservadora):**
  - **Zona horaria:** `desde`/`hasta` son días de Colombia, inclusivos. Como `fecha_hora` está en UTC, el día D se
    filtra de D 05:00 a D+1 05:00 UTC con desfase fijo UTC-5 (Colombia no tiene horario de verano; el mismo criterio
    de `utils/fechaColombia.js`), sin depender de la zona de la sesión de Postgres. Así una venta de las 11 p. m.
    del 31 de diciembre cuenta en ese año. Los demás reportes (`/api/ventas`, movimientos) **siguen en UTC**; no se
    tocaron (ver pendiente de fechas en UTC arriba).
  - **Semana:** de lunes a domingo (ISO), la que contiene la fecha.
  - **Ventas anuladas:** no cuentan en nada (igual que `GET /api/ventas`).
  - **Más/menos vendidos:** por unidades (empate: más/menos dinero, luego nombre); `total` = Σ cantidad ×
    `precio_unitario` de `venta_detalle`. Los menos vendidos incluyen productos **activos** con 0 unidades en el
    periodo (lo útil para un negocio: lo que no rota); un inactivo solo aparece si se vendió en el periodo.
  - **Movimientos:** el Kardex solo tiene `entrada`/`salida`. `ajustes` = salidas con motivo `ajuste`; `salidas` = las
    demás salidas (ventas), sin contar el ajuste dos veces; `entradas` = todas las entradas (`compra` y la
    devolución de stock por `anulacion`). Se cuenta el Kardex tal cual, incluidas las salidas de ventas que luego se
    anularon (su `anulacion` aparece como entrada).
  - **Serie:** `ventas_por_dia` trae todos los días del rango, también los que no tuvieron ventas (365/366 en el año).
- **Pruebas:** `test/reportes.test.js`. Rangos y validación corren siempre en `npm test`. La integración (cada periodo
  con datos de prueba: límites de medianoche en Colombia, anulada, inactivos, empates, periodo vacío, fecha por
  defecto, 400/401/403) corre solo con `PRUEBA_DATABASE_URL=<postgres local> npm test` sobre una base **recién creada**
  (si ya tiene productos o no es localhost, se salta: nunca borra nada ni toca Supabase). Verificado el 2026-10-11
  contra PGlite local: 11/11 en el archivo y `npm test` 62 + 1 saltada sin base. Las respuestas de los endpoints
  existentes no cambiaron (solo se agregó la ruta); la app Android lo usa en la pantalla "Reportes" (app `e9e3de7`).

## Alertas de stock (`GET /api/alertas-stock`)
### Inspección (Paso 0, 2026-10-11, sobre `b505043`)
- **productos:** `stock_actual` y `umbral_alerta` son `integer NOT NULL DEFAULT 0` (el "stock mínimo"); `activo` 0/1
  (migración aditiva). `alerta_stock_bajo` no es columna: lo calcula `productoService` (`stock_actual <= umbral_alerta`).
  `categorias.nombre` por `id_categoria`.
- **ventas / venta_detalle:** `ventas.fecha_hora` es `timestamp(0)` en UTC, `estado` activa/anulada (las anuladas no se
  borran). `venta_detalle.cantidad` es entero; es la única fuente de unidades vendidas (mesa y mostrador).
- **Patrón de `/api/reportes` que se reutiliza:** `routes` (`router.use(auth, requireRole("administrador", "cajero"))`)
  → `controller` (lee `req.query`) → `service` (valida y lanza `ErrorValidacion` → 400 `{error}`) → `model` (SQL con
  `db.uno`/`db.todos`). Día de Colombia D = `[D 05:00, D+1 05:00)` UTC comparando la columna tal cual; "hoy" con
  `hoyColombia()`. Errores async de Express 5 llegan solos a `manejoErrores`. `db.js` convierte `INT8` y `NUMERIC` a
  `Number`.
- **Pruebas:** `node --test`; la integración solo corre con `PRUEBA_DATABASE_URL` hacia localhost y sobre una base
  recién creada (si tiene productos, se salta); usuarios de cada rol creados en la prueba; peticiones con `fetch` a
  `app.listen(0)`.

### Implementación (COMPLETA, 2026-10-11)
`routes/alertasStock.routes.js` → `alertaStockController` → `alertaStockService` (parámetros, ventana, resumen) →
`alertaStockModel` (una consulta SQL). Solo lectura, sin bitácora. Las respuestas de los endpoints existentes no cambiaron.
- **`GET /api/alertas-stock[?ventana_dias=30&cobertura_alerta_dias=5&dias_objetivo=14]`**, administrador y cajero
  (mesero 403, sin token 401). Cada parámetro es un entero de 1 a 365; vacío o ausente → su valor por defecto; otro
  valor → 400 "`<nombre>` debe ser un número entero entre 1 y 365.".
- **Respuesta:** `{parametros:{ventana_dias, cobertura_alerta_dias, dias_objetivo, desde, hasta, zona_horaria:
  "America/Bogota"}, resumen:{total, agotado, bajo_minimo, por_agotarse}, productos:[{id_producto, nombre,
  categoria_nombre, unidad_medida, stock_actual, umbral_alerta, estado, unidades_vendidas, promedio_diario,
  dias_cobertura, cantidad_sugerida}]}`. Solo productos **activos** con estado distinto de "ok", ordenados por urgencia
  (agotado, bajo_minimo, por_agotarse) y luego por `unidades_vendidas` descendente (empate: nombre, id).
- **Cálculo (en SQL, por producto):** `unidades_vendidas` = Σ `venta_detalle.cantidad` de ventas **activas** en la
  ventana; `promedio_diario` = unidades / ventana_dias; `dias_cobertura` = stock / promedio (`null` sin ventas);
  estado con prioridad `agotado` (stock ≤ 0) → `bajo_minimo` (stock ≤ umbral) → `por_agotarse` (cobertura <
  cobertura_alerta_dias) → `ok`; `cantidad_sugerida` = max(0, ceil(promedio × dias_objetivo − stock)), salvo
  **agotado o bajo_minimo sin ventas en la ventana: max(0, umbral_alerta × 2 − stock_actual)** (desde 2026-10-11, a pedido
  del usuario; antes daba 0). Mismo campo y mismo tipo (entero): la app Android no necesita cambios para leerlo.
- **Decisiones ante ambigüedad (la opción más conservadora):**
  - **Ventana:** los `ventana_dias` días de calendario de Colombia que terminan **hoy, incluido** (`desde` = hoy −
    (ventana − 1)), con el mismo filtro UTC-5 de `/api/reportes`. El día de hoy cuenta aunque esté en curso.
  - **Sin redondeos en las decisiones:** la comparación de cobertura y la cantidad sugerida se hacen con enteros
    (`stock × ventana < cobertura × unidades`; `ceil(unidades × objetivo / ventana − stock)`). `promedio_diario` (2
    decimales) y `dias_cobertura` (1 decimal) se redondean solo para mostrarse. Cobertura exactamente igual al límite →
    `ok` (la regla es "menor que").
  - **Sin ventas:** `promedio_diario` 0, `dias_cobertura` null, nunca `por_agotarse`; si está agotado o bajo el
    mínimo, la cantidad sugerida repone hasta el doble del mínimo (`umbral × 2 − stock`, nunca negativa; con mínimo 0
    da 0). Ejemplos: stock 0 y mínimo 3 → 6; stock 5 y mínimo 5 → 5; stock 3 y mínimo 5 → 7.
  - **Parámetros enteros** (no se aceptan decimales) y tope de 365 días.
  - **`resumen`** se cuenta en el servicio sobre las filas que devolvió la consulta (el cálculo por producto es SQL).
  - Inactivos nunca aparecen (aunque estén agotados); las ventas anuladas no cuentan.
- **Pruebas:** `test/alertasStock.test.js`. Parámetros, ventana (cruce de año, bisiesto) y resumen corren siempre (modelo
  reemplazado). La integración (cada estado, producto sin ventas, ventas anuladas, inactivo, límite exacto de cobertura,
  primer y último día de la ventana, parámetros, 400/401/403) corre con `PRUEBA_DATABASE_URL` sobre una base **recién
  creada**. Como `test/reportes.test.js` también exige base vacía, en un mismo `npm test` con una sola base el segundo se
  salta: cada archivo de integración se corre con su propia base. Verificado el 2026-10-11 contra PGlite local en memoria
  (`pglite-server`, instalado en una carpeta temporal fuera del repo; nunca Supabase): 6/6 en `alertasStock.test.js`,
  11/11 en `reportes.test.js` con otra base nueva, y `npm test` 64 + 2 saltadas sin base. Con la regla del doble del
  mínimo, de nuevo 6/6 sobre una base nueva (se agregó "Coñac": agotado sin ventas y mínimo 0 → 0).
- **Ojo con `pglite-server` en Windows:** detener la tarea en segundo plano deja vivo el proceso `node` hijo con la base
  en memoria (y su puerto). Antes de reutilizar un puerto, buscar y cerrar los `node.exe` cuyo comando contenga
  `pglite-socket`; si no, la integración ve la base vieja con datos y se salta.

### Verificación (2026-10-11)
- **Despliegue (Render):** sin token, `GET /api/reportes?periodo=dia` → 401 y `GET /api/alertas-stock` → 401: ambas
  rutas están desplegadas en producción.
- **Permisos en producción con usuarios reales:** no se verificaron; las variables de credenciales no estaban en el
  entorno. En local (pruebas de integración) administrador y cajero 200, mesero 403, sin token 401.
- **Coherencia contra PGlite local** (script desechable fuera del repo; base en memoria eliminada al terminar): un
  producto con stock 0 → `agotado`; stock 3 con mínimo 5 → `bajo_minimo`; stock 4 con 40 vendidas hoy → `por_agotarse`
  (cobertura 3 días; una venta anulada de 100 unidades no contó); uno con stock 500 no aparece; resumen 1/1/1. El
  `total_vendido` de `/api/reportes?periodo=dia` (425000, 3 ventas) coincidió con la suma de las ventas de prueba
  activas. Se hizo antes de la regla del doble del mínimo (con ella, los dos sin ventas sugerirían 10 y 7).

## Chatbot para el personal (`/api/chatbot`, Gemini)
### Inspección (Paso 0, 2026-10-11, sobre `ca30aec`)
- **Lógica a reutilizar sin HTTP:** `reporteService.porPeriodo({periodo, fecha})` (valida y lanza `ErrorValidacion`;
  `fecha` por defecto `hoyColombia()`) y `alertaStockService.listar(query, hoy)`; los dos devuelven el mismo objeto que
  sus endpoints. Se llaman como propiedad del módulo (`reporteService.porPeriodo(...)`), así las pruebas pueden
  reemplazarlas. `utils/periodoReporte.js` exporta `PERIODOS`, `leerFecha` (fecha real AAAA-MM-DD) y `rangoPeriodo`.
- **Rutas y roles:** `router.use(auth, requireRole("administrador", "cajero"))`; `auth` deja `req.usuario =
  {id_usuario, usuario_login, rol}` del JWT. `app.use(express.json())` + `req.body` normalizado a `{}`.
- **Límite de peticiones:** `middlewares/limiteIntentos.js` (ventana fija en memoria, por IP, `ErrorDemasiadosIntentos`
  → 429 con `Retry-After`). Para el chatbot hace falta contar por usuario.
- **Logs:** Pino con `redact` por nombre de campo y `limpiarTexto` (JWT y cadenas base64url/hex de 32+ caracteres, que
  incluye la forma de las claves de Google `AIza…`, 39). `registroPeticiones` nunca registra cuerpos, encabezados ni
  query string. `logger.test.js` muestra cómo capturar la salida (`registro.logger = crearLogger({destino})`) y firmar
  JWT sin base de datos.
- **Node:** v24.18.0 en local (`fetch` y `AbortController` nativos desde Node 18). `package.json` no fija `engines`;
  Render usa su Node por defecto (≥ 18 desde 2023).
- **Entorno:** `.env` (no versionado) no tiene variables de Gemini. Ojo: `app.js` y `db.js` cargan `.env` con dotenv
  desde el directorio actual; las pruebas fijan sus variables antes y nunca llaman al Gemini real.
- **Gemini (docs oficiales, consultadas el 2026-10-11):** `POST https://generativelanguage.googleapis.com/v1beta/models/
  {modelo}:generateContent` con la clave en el encabezado `x-goog-api-key` (no en la URL, para que nunca quede en un log);
  `tools[].functionDeclarations`, la respuesta trae `candidates[0].content.parts[]` con `functionCall {name, args}` o
  `text`; la respuesta de la herramienta vuelve como `functionResponse`. Modelo estable más reciente con function
  calling: `gemini-3.8-flash` (GA 2026-09-02). Google recomienda la nueva Interactions API para proyectos nuevos, pero
  `generateContent` sigue soportada; se usa esta por ser la REST documentada con function calling.

### Implementación (COMPLETA, 2026-10-11)
`routes/chatbot.routes.js` (auth + `requireRole("administrador", "cajero")`; límite solo en el POST) →
`chatbotController` (al servicio solo le pasa `{mensaje, pregunta_id}` del cuerpo, nunca `req.usuario`) →
`chatbotService` (validación, preguntas rápidas, bucle de herramientas, caída al modo básico) → `geminiService`
(una llamada HTTP) y `chatbotPlantillas` (textos y formato de pesos con `Intl` es-CO, igual que el PDF).
- **`GET /api/chatbot/preguntas`** → `{preguntas:[{id, texto}]}`: `ventas_hoy`, `ventas_semana`, `mas_vendidos_mes`,
  `reabastecer`, `agotados`.
- **`POST /api/chatbot`** `{mensaje}` o `{pregunta_id}` → `{respuesta, origen: "ia" | "basico"}`. 400: sin ninguno,
  con ambos, `mensaje` que no es texto, vacío tras quitar espacios o de más de 500 caracteres (se cuentan caracteres
  Unicode después de `trim`), `pregunta_id` desconocido (también nombres del prototipo como "constructor"). 429 tras 20
  mensajes en un minuto del mismo usuario (`Retry-After`).
- **Gemini** (`geminiService.generar`): `GEMINI_API_KEY` (sin ella: `sin_clave`, no se llama) y `GEMINI_MODEL` (por
  defecto `gemini-3.8-flash`; solo `[\w.-]`, si no `modelo_invalido`). Clave en `x-goog-api-key`. Timeout de 20 s por
  llamada con `AbortController` (incluye leer el cuerpo). Devuelve `candidates[0].content` tal cual o lanza `ErrorGemini`
  con un `motivo` fijo: `timeout`, `red`, `http_<código>`, `respuesta_invalida`.
- **Bucle** (`responderConIA`): prompt de sistema en español con la fecha de hoy en Colombia; herramientas
  `obtener_reporte(periodo, fecha?)` y `obtener_alertas_stock()`; máximo **3 rondas** de herramientas por mensaje (una
  4.ª petición de herramientas → modo básico). El turno del modelo vuelve tal cual (conserva `thoughtSignature`, que
  Gemini 3 exige) y cada `functionResponse` lleva el `id` de su llamada si vino. Texto final: partes de texto sin
  `thought`; vacío o de más de 4000 caracteres → inválido.
- **Validación de argumentos de Gemini** (antes de tocar la base): `periodo` en `dia|semana|mes|anio`; `fecha`
  opcional, fecha real AAAA-MM-DD y no posterior a hoy en Colombia. Un argumento inválido o una herramienta desconocida
  vuelve a Gemini como `{error: "..."}` (no se consulta nada) y el prompt le exige decir que no tiene el dato.
  `obtener_alertas_stock` ignora cualquier argumento y usa los valores por defecto del endpoint.
- **Datos que recibe Gemini:** resúmenes armados en `resumenReporte`/`resumenAlertas`: periodo y rango, totales,
  número de ventas, ticket promedio, más y menos vendidos (nombre, unidades, total), movimientos, días con ventas, y por
  alerta nombre, estado, stock, mínimo, vendidas, cobertura y sugerida. El dinero va además como `*_texto` ya formateado
  ("$ 425.000") para que el modelo no formatee. Sin ids, usuarios, clientes ni tokens.
- **Modo básico:** las 5 plantillas de `chatbotPlantillas` (top 3 de hoy; mejor día de la semana; top 5 del mes;
  alertas con "pedir N" o "sin cantidad sugerida (pocas ventas recientes)", máximo 15 y "… y N más"; agotados).
  Texto libre sin IA → "Ahora mismo solo puedo responder las preguntas rápidas:" + la lista.
- **Decisiones ante ambigüedad (la más conservadora):**
  - **Nunca error por Gemini:** cualquier falla del camino con IA (también una excepción al leer los datos dentro de
    una herramienta) responde el modo básico con 200. Las preguntas rápidas sí pueden dar 500 si la base falla (no hay
    nada que responder sin datos).
  - **`mensaje` y `pregunta_id` juntos → 400** (no se elige uno en silencio).
  - **Límite:** cuenta todos los POST del usuario en ventana fija de 60 s (también los 400 y las preguntas rápidas);
    `GET /preguntas` no cuenta. En memoria y por instancia (Render free corre una). `limiteIntentos` ganó las opciones
    `clave` (por defecto la IP) y `mensaje`; el catálogo no cambió.
  - **Log:** solo `warn` con `motivo` y `tipo` al caer al modo básico (no si es `sin_clave`, que es la configuración
    normal sin IA). Nunca el mensaje, la respuesta, el cuerpo enviado ni la clave. La clave además tiene la forma
    `AIza…` de 39 caracteres, que `limpiarTexto` ya censura por patrón.
  - **Peor caso de tiempo:** hasta 4 llamadas de 20 s (3 rondas + texto final) ≈ 80 s; el cliente debe esperar más
    que eso o mostrar "pensando…". Con un fallo, cae al modo básico apenas ocurre.
  - Temperatura 0,2 y `maxOutputTokens` 1024 (respuestas cortas, pocas variaciones).
- **Pruebas:** `test/chatbot.test.js` (13). 12 sin base: preguntas y permisos (200/403/401, token inválido),
  validaciones 400, límite (20 → 429 con `Retry-After`, otro usuario sigue), cada plantilla con datos fijos y sin datos,
  sin clave, flujo con herramienta simulada (URL, encabezado, prompt, herramientas, `thoughtSignature`, `id`,
  `functionResponse`, nada de usuarios ni tokens en el cuerpo), argumentos inválidos que no llegan a la lógica,
  `GEMINI_MODEL`, caídas (HTTP 500 y 429, red, timeout, sin candidates, JSON roto, texto vacío, solo razonamiento, texto
  enorme, 4 rondas) con su `motivo` en el log, y la clave nunca en respuestas ni logs. Gemini siempre simulado
  (`geminiService.dependencias.fetch`) y además `globalThis.fetch` bloquea `googleapis.com`. 1 de integración con base
  local recién creada: las 5 preguntas rápidas con datos reales (venta anulada excluida). Verificado el 2026-10-11:
  13/13 contra PGlite en memoria (cerrado al terminar) y `npm test` 76 + 3 saltadas sin base.

## Panel web: Reportes, Alertas de stock y Asistente
### Inspección (Paso 0, 2026-10-11, sobre `d04de21`)
- **Archivos:** `public/panel/` (panel interno: una página HTML por sección con su `<script>` inline, más `api.js`,
  `menu.js`, `csv.js`, `factura.js` y `panel.css`) y `public/catalogo/index.html` (catálogo público, carga solo
  `/panel/api.js`). Express sirve cada carpeta aparte (`/panel`, `/catalogo`); las páginas son estáticas y públicas como
  archivo, los datos los protege la API (JWT + roles).
- **Login y token:** `login.html` guarda `token` y `usuario` (`{nombre, usuario_login, rol}`) en `localStorage`; si ya
  hay token lo valida con `GET /api/auth/me` y va a `pedidos.html`. Cada página: `if (!token())` reemplaza el `body` por
  "Debes iniciar sesión primero en login.html". **Ninguna página redirige al login con un 401**: `Api.pedir` lanza
  `ApiError(status)` y la página muestra el aviso ("Tu sesión expiró. Vuelve a iniciar sesión.").
- **Llamadas a la API:** `Api.pedir(ruta, {method, body, auth, respuesta})` (agrega `Bearer`, convierte todo error en
  `ApiError(mensaje, status)`, `status` 0 sin red; sin timeout propio) y avisos `Api.error`/`Api.exito` (toasts).
- **Menú:** la barra lateral (`aside.sidebar` > `nav.sidebar-nav` con `a.nav-item` + ícono SVG en línea) está **repetida
  en cada HTML**; la página actual lleva `.activo`. `menu.js` (todas las páginas menos login) quita los `.solo-admin` si
  el rol no es administrador, quita "Login" con sesión y agrega "Cerrar sesión". **No hay clase para "solo
  administrador y cajero"**: hoy el mesero ve todas las entradas salvo "Datos del negocio" y recibe el 403 en la página.
- **Roles en pantalla:** `JSON.parse(localStorage.usuario).rol` (p. ej. `puedeCancelar()` en Pedidos); un 403 de carga
  reemplaza `#contenido` por `<p class="error-permiso">No tienes permiso para ver esta sección.</p>`.
- **Estilo:** `panel.css` (variables `--azul-oscuro`, `--gris-*`, `--rojo`; `.tarjetas/.tarjeta .numero/.etiqueta`,
  `.seccion`, tablas con `thead th` en versalitas, `.badge-*` incl. `.badge-agotado` y `.badge-alerta`, `.btn`,
  `.btn-primario` (uno por página), `.oculto`, `.tabla-desplazable`, `.celda-aviso`). Solo las páginas con `<meta
  name="viewport">` (hoy Inventario) usan el diseño de celular (`@media (max-width: 720px)`).
- **Código compartido con Node:** `csv.js` define un objeto global y al final `if (typeof module !== "undefined")
  module.exports = Csv`, así el servidor y las pruebas lo cargan con `require`. No hay pruebas de frontend ni navegador
  en las pruebas; se verifica con `node --test` y, a mano, con Chrome headless.

### Implementación (COMPLETA, 2026-10-11)
Archivos nuevos, todos en `public/panel/` (el catálogo no los carga ni los enlaza): `reportes.html`, `alertas.html`,
`asistente.html` (misma estructura que las demás: barra lateral copiada, `<script>` en línea, `<meta name="viewport">`)
y `gestion.js` (funciones puras, objeto global `Gestion` + `module.exports`). Cambios compatibles en lo compartido:
- **Menú:** las 7 páginas que ya existían y las 3 nuevas tienen en la barra lateral "Alertas de stock" (después de
  Inventario), "Reportes" y "Asistente" (después de Ventas): mismo orden que la app Android. Llevan la clase nueva
  **`.solo-gestion`**, que `menu.js` quita si el rol no es administrador ni cajero (como `.solo-admin`). Las demás
  entradas no cambiaron (el mesero sigue viéndolas como antes).
- **Contador de alertas** (`menu.js`, `MenuPanel.actualizarContadorAlertas(n)`): número de productos con estado conocido
  (`agotado`, `bajo_minimo`, `por_agotarse`; "99+" si pasa de 99; nada si es 0) en `span.nav-contador` junto a "Alertas
  de stock". Se consulta **una vez al entrar al panel** (primera página con sesión de la pestaña) y se guarda en
  `sessionStorage` (`contadorAlertas`, con los últimos 16 caracteres del token para no mostrar el de otra sesión); las
  demás páginas lo reutilizan sin consultar, y `alertas.html` lo actualiza cada vez que carga. Sin consultas periódicas.
  Un error (sin red, 401, 403) no muestra contador ni avisos. "Cerrar sesión" también lo borra.
- **`Api.pedir`** ganó `timeoutMs` opcional (solo lo usa el Asistente, 150 s): al vencer, `ApiError` con `status` 0 y
  `tiempoAgotado = true`. Sin la opción, todo funciona exactamente como antes.
- **`panel.css`:** solo clases nuevas al final (`.nav-contador`, `.chip`, `.navegador-periodo`, `.caja-error`,
  `.estado-*`, `.grafica`, `.burbuja*`, …). Ojo: `.caja-error` declara `display: flex` después de `.oculto`, por eso
  existe `.caja-error.oculto { display: none }` (sin eso la caja oculta se veía; lo detectó la captura de Chrome).

**Reportes (`reportes.html`):** chips Día/Semana/Mes/Año (`aria-pressed`), "‹ Anterior" / "Siguiente ›" (desactivado si el
periodo siguiente empieza después de hoy; si lo contiene, la fecha queda en hoy), `input type=date` con `max` = hoy en
Colombia (una fecha futura o borrada se lleva a hoy) y "Hoy". Rango legible del `rango` de la respuesta (mientras carga,
el calculado en el navegador). Tarjetas total vendido / número de ventas / ticket promedio en pesos; gráfica SVG propia
(`geometriaBarras`, `<title>` por barra, máximo encima; año agrupado por mes; ≤ 12 barras rotuladas, si no la primera y la
última; vacía → "Sin datos para graficar."); tablas Más/Menos vendidos (#, producto, unidades, total); movimientos
(entradas, salidas, ajustes: unidades y movimientos). Estados: "Cargando reporte…", error con Reintentar (403: "No tienes
permiso para ver reportes", sin Reintentar), vacío "Sin ventas en este periodo" con los movimientos. Solo cuenta la última
consulta (cambios rápidos de periodo).
**Alertas (`alertas.html`):** sin parámetros (los del backend), texto con lo que significan; una sección por estado
(Agotado `.badge-agotado`, Bajo mínimo `.badge-alerta`, Por agotarse `.badge-nuevo`) con tabla Producto (con categoría ·
unidad) / Stock actual / Mínimo / Días de cobertura ("4,5 días", "—" sin ventas) / Cantidad sugerida ("—" si es 0). Sin
ventas recientes (`dias_cobertura` null): "Sin ventas recientes: no se calcula cobertura; se sugiere reponer hasta el
doble del mínimo." Estado desconocido u "ok": se ignora. "Actualizar", cargando, error con Reintentar (403 sin) y vacío
"Todo el stock está en orden".
**Asistente (`asistente.html`):** burbujas (usuario a la derecha, asistente a la izquierda) con **`textContent`** y
`white-space: pre-wrap`; etiqueta "IA" solo si `origen === "ia"`, cualquier otro valor "Rápida". Preguntas rápidas de
`GET /api/chatbot/preguntas` (solo las que traen `id` y `texto`; un `id` repetido sale una vez), que envían `pregunta_id`
(la burbuja del usuario muestra su texto). `textarea maxlength=500` + recorte por puntos de código (emojis) y contador
"N/500"; Enter envía, Mayús+Enter salta de línea. Un envío a la vez (botón y preguntas deshabilitados). "Escribiendo…" y a
los 10 s "El servidor puede estar despertando; la respuesta puede tardar hasta un par de minutos.". Espera de 150 s.
Errores (`Gestion.errorAsistente`): 401 → login; 403 → "No tienes permiso para usar el asistente" y chat bloqueado; 429 →
"Espera un momento antes de enviar otro mensaje" + Reintentar; 400 → mensaje del backend sin Reintentar; espera agotada →
"El asistente tardó demasiado…" + Reintentar; red o 5xx → mensaje + Reintentar; respuesta vacía → reintentable. Reintentar
reenvía el mismo cuerpo sin repetir la burbuja del usuario. La conversación vive solo en memoria y se borra al salir
(`pagehide`, y `pageshow` si el navegador devuelve la página desde su caché).

**Decisiones ante ambigüedad (la más conservadora):**
- **401 en las secciones nuevas → login:** se borran `token` y `usuario` y se va a `login.html` con `location.replace`
  (como pide el diseño y como hace la app). Las páginas que ya existían siguen mostrando solo el aviso "Tu sesión
  expiró…"; no se cambiaron. Sin bucle: el login sin token muestra el formulario.
- **"Al entrar al panel"** = la primera página con sesión de la pestaña (el panel es de varias páginas, no SPA): una
  consulta por pestaña y sesión, no una por cada página visitada. El contador puede quedar desactualizado tras una venta
  hasta que se abre Alertas de stock.
- **Hoy** = hoy en Colombia (UTC-5) con el reloj del navegador, igual que el backend.
- Las tablas de cantidades muestran "—" en vez de "0" para la cantidad sugerida 0 (no hay nada que pedir).
- Menú en celular: las páginas nuevas declaran viewport (como Inventario); las demás siguen a 980 px como antes.

**Pruebas** (sin navegador): `test/panelGestion.test.js` (9: hoy en Colombia, rangos idénticos a
`utils/periodoReporte.js` para cada periodo y fecha, anterior/siguiente, rango legible, pesos y números, serie y
agrupación por mes, geometría de barras con vacío/un punto/ceros, agrupación de alertas con estados desconocidos, límite
de 500, etiqueta de origen y errores del asistente) y `test/panelWeb.test.js` (9: las páginas y `gestion.js` se sirven
en `/panel` y dan 404 en `/catalogo`; el catálogo solo carga `/panel/api.js` y no menciona nada de las secciones;
ninguna página del panel usa scripts externos ni referencias rotas; las 10 páginas tienen las 3 entradas
`solo-gestion` en orden y una sola activa; `menu.js` ejecutado con un DOM mínimo en `vm`: entradas por rol, contador una
vez por pestaña, otra sesión consulta de nuevo, mesero nunca consulta, error sin contador, cerrar sesión lo borra; sin
`innerHTML` con datos; e integración con base local: los 3 endpoints con la forma de siempre, mesero 403 y sin token 401).
Verificado el 2026-10-11: 9/9 + 9/9 contra PGlite en memoria; `npm test` 93 + 4 saltadas sin base; y **Chrome headless**
(protocolo de depuración desde Node, script desechable fuera del repo, backend local + PGlite, sin `GEMINI_API_KEY`):
61 comprobaciones de administrador, cajero, mesero, 401 y catálogo (cifras, rango, fecha futura → hoy, año por meses,
vacío con movimientos, grupos y aviso sin ventas, contador, un nombre de producto `<img onerror>` mostrado como texto y
sin ejecutarse, preguntas rápidas, 500 caracteres, Enter, 429 + Reintentar sin duplicar, "Escribiendo…" y aviso a los
10 s, 400 sin Reintentar, timeout, chat vacío al volver, 403 del mesero en las tres) y capturas a 1366 y 390 px.
PGlite y Chrome cerrados al terminar.

## Pendientes futuros (no urgentes)
- La app Android ya refleja todo lo de este backend: campos nuevos de productos y proveedores,
  impuestos deshabilitados para el cajero y `cliente.correo` al cobrar (app `82941d4`, `c887b11`,
  `e861c27`), y `GET /api/reportes` y `GET /api/alertas-stock` tienen pantalla en la app.
- Panel web: Reportes, Alertas de stock y Asistente probados en Chrome headless contra backend local; falta la prueba del
  usuario contra producción (Render debe tener desplegado este `main`).
- Chatbot: para usar la IA en producción hay que poner
  `GEMINI_API_KEY` en Render (ver README); sin ella responde en modo básico. No se probó contra el Gemini real (las
  pruebas lo simulan): la primera prueba real dirá si el modelo por defecto y el formato de `functionResponse` sirven tal
  cual; si no, el chatbot cae al modo básico y el log muestra el `motivo` (p. ej. `http_400` o `http_404`).
- Desplegar en Render: `/api/reportes` y `/api/alertas-stock` solo existen en producción cuando Render tenga
  desplegado este `main`; la app muestra "No se encontró el recurso solicitado." mientras tanto.
- Siguen vigentes los ya descritos en **Estado actual**: tarifas de IVA/INC por validar con el
  contador, transmisión a la DIAN vía proveedor tecnológico (hoy 501) y nota crédito (CUDE).

## Permisos por rol (fuente de verdad)
Verificados con curl el 2026-09-26 sobre `6b404ad`, en local contra una base desechable con
`admin`, `cajero_prueba` y `mesero_prueba` (las acciones que modifican datos nunca se prueban contra
Supabase). El código HTTP real coincidió en todos los casos con `requireRole(...)` en `src/routes/*.routes.js`;
la única comprobación de rol fuera de las rutas es `productoService.verificarPermisoImpuestos` (ver nota (1)). Permitido = 200/201 (transmitir: 501 porque aún
no está conectado); no permitido = 403 con token, 401 sin token. **No cambiar un permiso sin actualizar
esta tabla** (y la de `LicoreriaPanel/CLAUDE.md`).

| Acción | Administrador | Cajero | Mesero |
|---|---|---|---|
| Crear mesa (`POST /api/mesas`) | Sí | No | No |
| Ver mesas (`GET /api/mesas[/:id]`) | Sí | Sí | Sí |
| Ver QR de mesa (`GET /api/mesas/:id/qr`) | Sí | Sí | No |
| Ver pedidos entrantes / marcar entregado | Sí | Sí | Sí |
| Cancelar pedido (`DELETE /api/pedidos/:id`) | Sí | Sí | No |
| Cerrar cuenta de mesa (genera factura) | Sí | Sí | No |
| Venta de mostrador (genera factura, `POST /api/ventas`) | Sí | Sí | No |
| Productos: listar, ver, crear, editar | Sí | Sí | No |
| Productos: tasas IVA/INC y "bebida alcohólica" | Sí | No (1) | No |
| Categorías: listar y crear | Sí | Sí | No |
| Proveedores: listar, ver, crear, editar, asociar y quitar producto | Sí | Sí | No |
| Inventario: entradas y salidas | Sí | Sí | No |
| Reportes: ventas y movimientos de inventario (JSON y CSV) | Sí | Sí | No |
| Reporte por periodo (`GET /api/reportes`) | Sí | Sí | No |
| Alertas de stock (`GET /api/alertas-stock`) | Sí | Sí | No |
| Chatbot del personal (`POST /api/chatbot`, `GET /api/chatbot/preguntas`) | Sí | Sí | No |
| Bitácora de auditoría (`GET /api/auditoria`) | Sí | No | No |
| Usuarios: listar y crear | Sí | No | No |
| Ver datos del emisor (`GET /api/emisor`) | Sí | Sí | No |
| Editar datos del emisor: negocio, NIT (`PUT /api/emisor`) | Sí | No | No |
| Cambiar título del documento (`PUT /api/emisor`) | Sí | No | No |
| Configurar factura electrónica y responsabilidad IVA/INC del emisor (`PUT /api/emisor`) | Sí | No | No |
| Ver resolución de numeración (`GET /api/emisor/resolucion`) | Sí | No | No |
| Editar resolución de numeración (`PUT`/`POST /api/emisor/resolucion`) | Sí | No | No |
| Listado de facturas / ver una factura | Sí | Sí | No |
| Ver e imprimir PDF de factura | Sí | Sí | No |
| Anular factura (revierte stock; reabre pedidos y mesa) | Sí | No | No |
| Factura electrónica: descargar XML UBL (con CUFE) | Sí | Sí | No |
| Factura electrónica: transmitir a la DIAN (hoy 501) | Sí | No | No |
| Catálogo público y autopedido por QR | sin login | sin login | sin login |
| Estado de la cuenta, factura y PDF del cliente (`/api/catalogo/sesion/*`) | con token de sesión del celular | con token de sesión del celular | con token de sesión del celular |

(1) Los impuestos van en el mismo `POST`/`PUT /api/productos` que admite al cajero, así que la regla
está en `productoService.verificarPermisoImpuestos` (servidor, antes de guardar): el cajero puede editar
un producto si `tasa_iva_bps`, `tasa_inc_bps` y `es_bebida_alcoholica` no vienen o son iguales a los
guardados, y **solo puede crear productos con los impuestos por defecto** (IVA 19 %, INC 0 %, no
alcohólica); cualquier otro valor → 403 "Solo el administrador puede modificar los impuestos de un
producto." sin guardar nada. En el panel esos campos quedan deshabilitados para el cajero. Pruebas:
`test/impuestosProducto.test.js` (2026-09-26).

La resolución de numeración se gestiona desde el panel (Datos del negocio → Resolución de numeración) con
`/api/emisor/resolucion`; ver **Estado actual**. Verificado con curl el 2026-09-26 en local: cajero y mesero → 403.

---

## Sprint 2 — Módulo de Inventario (Semana 3-4)

| Historia | RF | Depende de | Prioridad | Criterios de aceptación |
|---|---|---|---|---|
| US-04 Registrar productos | RF-04 | US-01 | Must | Crear/editar/consultar producto (nombre, categoría licor/paquetería, precio, unidad, stock); el stock nuevo se ve de inmediato en el listado. |
| US-05 Registrar proveedores | RF-05 | US-01 | Must | Crear proveedor (nombre, contacto); un proveedor se asocia a uno o más productos (tabla `producto_proveedor`). |
| US-06 Entradas de inventario | RF-06 | US-04, US-05 | Must | Una entrada aumenta el stock en la cantidad indicada; queda asociada a proveedor, fecha y usuario responsable. |
| US-07 Salidas de inventario | RF-07 | US-04 | Must | Una salida disminuye el stock; queda con motivo (venta/ajuste), fecha y usuario responsable. |
| US-09 Historial de movimientos | RF-09 | US-06, US-07 | Should | Filtrar el historial de un producto por rango de fechas; cada movimiento muestra tipo, cantidad, usuario, fecha. |
| US-08 Alertas de stock bajo | RF-08 | US-04, US-06, US-07 | Should | Un producto bajo su umbral se resalta en el listado; el umbral es configurable por producto. |

## Sprint 3 — Mesas y Pedidos por QR (Semana 5-6)

| Historia | RF | Depende de | Prioridad | Criterios de aceptación |
|---|---|---|---|---|
| US-10 QR por mesa | RF-10 | US-04 | Must | Cada mesa tiene un QR único e imprimible; escanearlo abre el catálogo de exactamente esa mesa. |
| US-11 Catálogo web por QR | RF-11 | US-04, US-10 | Must | Carga en <3s en 4G; solo muestra disponibilidad (no el stock exacto); sin instalar apps. |
| US-12 Autopedido del cliente | RF-12 | US-11 | Must | Agregar productos y confirmar en máx. 3 pasos; el pedido queda asociado automáticamente a la mesa del QR escaneado. |
| US-13 Panel de pedidos entrantes | RF-13 | US-12 | Must | El panel agrupa pedidos por mesa y se actualiza periódicamente (polling), sin recarga manual. |
| US-14 Cierre de cuenta por mesa | RF-14 | US-12, US-13 | Must | Al cerrar, se suman todos los pedidos de la mesa en un único total; la mesa queda libre para un nuevo cliente. |

## Sprint 4 — Venta sin Mesa y Reportes (Semana 7)

| Historia | RF | Depende de | Prioridad | Criterios de aceptación |
|---|---|---|---|---|
| US-15 Venta rápida sin mesa | RF-15 | US-04 | Must | Se puede registrar una venta sin mesa asociada; queda igual que una venta por mesa salvo por no tener `id_mesa`. |
| US-16 Descuento automático de inventario | RF-16 | US-07, US-12, US-15 | Must | Al confirmar cualquier venta, el stock baja automáticamente; no se puede vender más de lo disponible. |
| US-17 Reporte de ventas | RF-17 | US-14, US-15 | Should | Filtrar por rango de fechas; diferenciar ventas por mesa de ventas de mostrador. |
| US-18 Reporte de movimientos de inventario | RF-18 | US-06, US-07 | Should | Filtrar por usuario responsable; mostrar tipo, cantidad, producto, fecha, usuario. |
| US-14b Notificación de nuevo pedido | RF-14b | US-13 | Could (opcional) | El panel resalta un pedido recién llegado; sin WebSockets (polling). |
| US-19 Exportación de reportes | RF-19 | US-17, US-18 | Could (opcional) | Reportes de ventas e inventario descargables en CSV o PDF. |

---

## Cómo pedirle trabajo a Claude Code (recordatorio para el estudiante)
Un sprint a la vez, no el proyecto completo de una. Al final de cada sprint, revisar
el resumen antes de arrancar el siguiente.
