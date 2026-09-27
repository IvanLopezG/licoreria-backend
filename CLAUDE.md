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
  en el servicio, usa ese patrón).
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

## Pendientes futuros (no urgentes)
- **Android: correo del cliente al cobrar.** Antes de activar de verdad `modo_facturacion =
  'electronica_dian'`, agregar `cliente.correo` al flujo de cobro de la app Android
  (`DatosFacturaRequest` en `LicoreriaPanel`). Hoy no lo envía, y en modo electrónico un cobro
  con cliente identificado responde 400 ("cliente.correo es obligatorio"). En modo interno (el
  de por defecto) no afecta. La app tolera los campos nuevos de las respuestas
  (`ignoreUnknownKeys = true` en `ApiClient.kt`).

## Permisos por rol (fuente de verdad)
Verificados con curl el 2026-09-26 sobre `6b404ad`, en local contra una base desechable con
`admin`, `cajero_prueba` y `mesero_prueba` (las acciones que modifican datos nunca se prueban contra
Supabase). El código HTTP real coincidió en todos los casos con `requireRole(...)` en `src/routes/*.routes.js`;
no hay comprobaciones de rol en controladores ni servicios. Permitido = 200/201 (transmitir: 501 porque aún
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
| Bitácora de auditoría (`GET /api/auditoria`) | Sí | No | No |
| Usuarios: listar y crear | Sí | No | No |
| Ver datos del emisor (`GET /api/emisor`) | Sí | Sí | No |
| Editar datos del emisor: negocio, NIT (`PUT /api/emisor`) | Sí | No | No |
| Cambiar título del documento (`PUT /api/emisor`) | Sí | No | No |
| Configurar factura electrónica y responsabilidad IVA/INC del emisor (`PUT /api/emisor`) | Sí | No | No |
| Resolución de numeración (`secuencias_factura`) | — | — | — |
| Listado de facturas / ver una factura | Sí | Sí | No |
| Ver e imprimir PDF de factura | Sí | Sí | No |
| Anular factura (revierte stock; reabre pedidos y mesa) | Sí | No | No |
| Factura electrónica: descargar XML UBL (con CUFE) | Sí | Sí | No |
| Factura electrónica: transmitir a la DIAN (hoy 501) | Sí | No | No |
| Catálogo público y autopedido por QR | sin login | sin login | sin login |

(1) Los impuestos van en el mismo `POST`/`PUT /api/productos` que admite al cajero, así que la regla
está en `productoService.verificarPermisoImpuestos` (servidor, antes de guardar): el cajero puede editar
un producto si `tasa_iva_bps`, `tasa_inc_bps` y `es_bebida_alcoholica` no vienen o son iguales a los
guardados, y **solo puede crear productos con los impuestos por defecto** (IVA 19 %, INC 0 %, no
alcohólica); cualquier otro valor → 403 "Solo el administrador puede modificar los impuestos de un
producto." sin guardar nada. En el panel esos campos quedan deshabilitados para el cajero. Pruebas:
`test/impuestosProducto.test.js` (2026-09-26).

La resolución de numeración (prefijo, rango, resolución, vigencia, clave técnica) **no tiene endpoint**:
solo se cambia por SQL en Supabase.

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
