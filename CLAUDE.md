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
- Node.js + Express, arquitectura en capas: `rutas → controladores → servicios → modelos → SQLite`.
- `node:sqlite` (`DatabaseSync`, nativo desde Node 22.5+, sin flags desde 22.13/23.4),
  `bcryptjs` (hash de contraseñas), `jsonwebtoken` (auth). No usamos `better-sqlite3`:
  requiere compilar un binario nativo (node-gyp + Python + build tools de C++) que no
  están disponibles en todos los entornos de desarrollo del proyecto.
- `node:sqlite` no trae el helper `db.transaction()` de `better-sqlite3`. Cualquier
  operación multi-paso que deba ser atómica (p. ej. ajustar `stock_actual` +
  registrar en `movimientos_inventario`, como en `movimientoInventarioModel.js`)
  envuelve `BEGIN`/`COMMIT`/`ROLLBACK` a mano en el modelo con un helper tipo
  `conTransaccion(fn)`. Mismo patrón aplica en Sprint 3-4 para el cierre de cuenta
  por mesa (US-14: sumar `PEDIDO_DETALLE` en `VENTA_DETALLE` + total) y el
  descuento automático de inventario en ventas (US-16).
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
