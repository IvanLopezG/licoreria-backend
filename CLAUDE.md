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

## Pendientes futuros (no urgentes)
- La app Android ya refleja todo lo de este backend: campos nuevos de productos y proveedores,
  impuestos deshabilitados para el cajero y `cliente.correo` al cobrar (app `82941d4`, `c887b11`,
  `e861c27`). No quedan pendientes de Android.
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
