# Licorería — Backend (Sprint 1 a Sprint 4, completo)

Sprint 1 implementa US-01, US-02 y US-03 (RF-01 a RF-03). Sprint 2 agrega
US-04 a US-09 (RF-04 a RF-09, Módulo de Inventario). Sprint 3 agrega US-10 a
US-14 (RF-10 a RF-14, Mesas y Pedidos por QR). Sprint 4 agrega US-15 a US-19
(RF-15 a RF-19, Venta sin Mesa y Reportes), incluyendo las dos historias
opcionales (US-14b, US-19). Todo sobre la arquitectura y el modelo de datos
definidos en `08_Modelo_de_Datos_y_Arquitectura.docx`.

## Instalación

```bash
npm install
cp .env.example .env        # y cambia JWT_SECRET por un valor propio
npm start                   # http://localhost:3000
```

`npm start` ejecuta `node src/seed.js` antes de levantar el servidor
(`usuarioModel.existeAdministrador()` evita duplicar el admin si ya existe),
así que no hace falta correr `npm run seed` aparte — queda disponible solo
para volver a verificar el seed manualmente sin reiniciar el servidor. Esto
es clave en Render (plan gratuito, disco no persistente entre despliegues):
cada arranque recrea el admin y las categorías iniciales si el disco se
reinició.

La base de datos usa `node:sqlite` (nativo desde Node 22.5, sin flags desde
Node 22.13/23.4). Se eligió sobre `better-sqlite3` porque este último requiere
compilar un binario nativo (node-gyp + Python + build tools de C++), que no
están disponibles en todos los entornos de desarrollo. Requiere Node 22.5+.

`BASE_URL` (en `.env`, por defecto `http://localhost:3000`) es la URL pública
usada para construir el link del QR de cada mesa (`GET /api/mesas/:id/qr`,
US-10) — en Render se configura como variable de entorno con la URL real del
servicio, sin tocar código.

Panel de prueba en el navegador: **http://localhost:3000/panel/login.html**
Catálogo de cliente (Sprint 3), vía QR: **http://localhost:3000/catalogo/index.html?token=&lt;codigo_qr_token de la mesa&gt;**

## Estructura

```
src/
  db/            conexión SQLite (node:sqlite) + schema.sql (las 12 tablas del modelo completo)
  models/        usuarioModel, logAuditoriaModel, categoriaModel, productoModel,
                  proveedorModel, movimientoInventarioModel, mesaModel, pedidoModel,
                  ventaModel
  services/      authService, usuarioService, categoriaService, productoService,
                  proveedorService, movimientoInventarioService, mesaService,
                  catalogoService, pedidoService, ventaService
  controllers/   authController, usuarioController, auditoriaController,
                  categoriaController, productoController, proveedorController,
                  movimientoInventarioController, mesaController, catalogoController,
                  pedidoController, ventaController
  middlewares/   auth.js (JWT), roles.js (RBAC), auditoria.js (bitácora automática)
  utils/         csv.js (serialización CSV para los reportes exportables, US-19)
  routes/        auth, usuarios, auditoria, categorias, productos, proveedores,
                  inventario (entradas/salidas/historial), mesas, catalogo (público),
                  pedidos, ventas (venta de mostrador + reporte de ventas)
  app.js / server.js
public/panel/    login.html, mesas.html (crear mesas / imprimir QR), pedidos.html
                  (panel de pedidos entrantes, con polling y resaltado de pedidos
                  nuevos) — panel mínimo para probar el flujo a mano
public/catalogo/ index.html — catálogo público del cliente (sin login), abierto
                  al escanear el QR de una mesa
```

Los cuatro sprints ya tienen lógica de negocio completa sobre el mismo
esquema (`schema.sql`) definido desde Sprint 1.

## Endpoints

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | público | RF-01. Devuelve `{ token, usuario }`. |
| GET | `/api/auth/me` | autenticado | Info del usuario del token actual. |
| POST | `/api/usuarios` | administrador | RF-02. Crea un usuario (hash bcrypt). |
| GET | `/api/usuarios` | administrador | Lista usuarios (sin password_hash). |
| GET | `/api/auditoria` | administrador | RF-03. Bitácora, filtrable por `?id_usuario=` y `?entidad=`. |
| POST | `/api/categorias` | administrador, cajero | Crea una categoría (nombre único). |
| GET | `/api/categorias` | administrador, cajero | Lista categorías. |
| POST | `/api/productos` | administrador, cajero | RF-04. Crea producto (nombre, categoría, unidad, precio, stock inicial, umbral). |
| PUT | `/api/productos/:id` | administrador, cajero | RF-04. Edita producto (no toca stock_actual). |
| GET | `/api/productos` | administrador, cajero | RF-04/RF-08. Lista productos con `alerta_stock_bajo`; `?bajo_stock=true` filtra solo los que están en alerta. |
| GET | `/api/productos/:id` | administrador, cajero | Consulta un producto. |
| POST | `/api/proveedores` | administrador, cajero | RF-05. Crea proveedor (nombre, contacto). |
| GET | `/api/proveedores` | administrador, cajero | Lista proveedores. |
| GET | `/api/proveedores/:id` | administrador, cajero | Detalle de proveedor con sus productos asociados. |
| POST | `/api/proveedores/:id/productos` | administrador, cajero | Asocia un producto (`id_producto`) al proveedor. |
| POST | `/api/inventario/entradas` | administrador, cajero | RF-06. Registra entrada (`id_producto`, `cantidad`, `id_proveedor`); aumenta stock. |
| POST | `/api/inventario/salidas` | administrador, cajero | RF-07. Registra salida (`id_producto`, `cantidad`, `motivo`: venta/ajuste); disminuye stock. |
| POST | `/api/mesas` | administrador | RF-10. Crea una mesa (`numero`); genera `codigo_qr_token` único. |
| GET | `/api/mesas` | administrador, mesero, cajero | Lista mesas con su estado (`libre`/`ocupada`). |
| GET | `/api/mesas/:id` | administrador, mesero, cajero | Detalle de una mesa. |
| GET | `/api/mesas/:id/qr` | administrador, cajero | RF-10. Devuelve `{ url, qr_data_url }` (PNG en base64) para imprimir; `url` se arma con `BASE_URL` del `.env`. |
| POST | `/api/mesas/:id/cerrar-cuenta` | administrador, cajero | RF-14. Consolida los pedidos abiertos de la mesa en una venta, libera la mesa y emite su factura (transacción). Cuerpo opcional: ver *Facturación*. Responde la venta con `factura`. |
| GET | `/api/catalogo/:token` | público (sin login) | RF-11. Catálogo de la mesa identificada por su `codigo_qr_token`; solo productos con `stock_actual > 0`, sin exponer el stock exacto. |
| POST | `/api/catalogo/:token/pedidos` | público (sin login) | RF-12. Autopedido del cliente (`items: [{ id_producto, cantidad }]`); asocia el pedido a la mesa del token y la marca `ocupada`. |
| GET | `/api/pedidos` | administrador, mesero, cajero | RF-13. Panel de pedidos entrantes, filtrable por `?estado=` y `?id_mesa=`. |
| PUT | `/api/pedidos/:id/entregado` | administrador, mesero, cajero | Marca un pedido como entregado. |
| POST | `/api/ventas` | administrador, cajero | RF-15. Venta rápida sin mesa (`items: [{ id_producto, cantidad }]`); descuenta stock (RF-16) y emite la factura en la misma transacción. Acepta los mismos campos opcionales de facturación. |
| GET | `/api/ventas` | administrador, cajero | RF-17. Reporte de ventas, filtrable por `?desde=`, `?hasta=`, `?tipo=` (mesa/mostrador); `?formato=csv` lo descarga como CSV (RF-19). Excluye las ventas anuladas salvo `?incluir_anuladas=true`; cada venta trae `estado`, `id_factura` y `numero_factura`. |
| GET | `/api/inventario/movimientos` | administrador, cajero | RF-09/RF-18. Historial filtrable por `?id_producto=`, `?desde=`, `?hasta=` y `?id_usuario=` (responsable); `?formato=csv` lo descarga como CSV (RF-19). |
| GET | `/api/facturas` | administrador, cajero | Lista facturas, filtrable por `?desde=` y `?hasta=`. |
| GET | `/api/facturas/:id` | administrador, cajero | Factura con sus `items`. |
| GET | `/api/facturas/:id/pdf` | administrador, cajero | PDF imprimible (tirilla de 80 mm). |
| POST | `/api/facturas/:id/anular` | administrador | Anula la factura y revierte su venta. Body: `{ motivo, reabrir_pedidos? }`. Ver *Anulación*. |
| GET | `/api/emisor` | administrador, cajero | Datos del negocio que salen en la factura. |
| PUT | `/api/emisor` | administrador | Edita esos datos (parcial: los campos que no se envían se conservan). El `dv` lo calcula el servidor a partir del `nit` (algoritmo DIAN, módulo 11); un `dv` distinto responde 400. `titulo_documento`: "Comprobante de venta" o "FACTURA DE VENTA" (esta última solo con resolución DIAN). |

## Facturación (comprobante interno de venta)

Cada venta (cierre de mesa o mostrador) emite una factura en la **misma transacción**
(`BEGIN IMMEDIATE`): si algo falla, se revierten la venta, el stock y el número de
factura, así que la numeración no tiene saltos. No hay integración con la DIAN; el
título del documento es configurable (`emisor.titulo_documento`, hoy "Comprobante de venta").

- **Tablas:** `emisor` (una fila), `secuencias_factura` (consecutivo; `prefijo`, rango y
  resolución quedan listos para la DIAN; solo una activa), `facturas` (copia de los datos
  del emisor y del cliente, totales) y `factura_items` (nombre, precio y tasas copiados).
- **Productos:** `tasa_iva_bps` (defecto 1900), `tasa_inc_bps` (defecto 0) y
  `es_bebida_alcoholica`, en puntos básicos (1900 = 19 %). Si no se envían al editar, se conservan.
  En una base existente, `db.js` agrega estas columnas al arrancar.
- **Impuestos:** el precio ya incluye el impuesto y la base se despeja por línea.
  `en_sitio` → INC con `tasa_inc_bps`; `para_llevar` → IVA con `tasa_iva_bps`; nunca ambos.
  **Tarifas pendientes de confirmar con el contador.**
- **Cuerpo opcional al cobrar** (si no se envía: efectivo, Consumidor Final y el tipo de
  consumo según la venta — mesa → `en_sitio`, mostrador → `para_llevar`):
  ```json
  { "forma_pago": "efectivo|tarjeta_debito|tarjeta_credito|transferencia",
    "tipo_consumo": "en_sitio|para_llevar",
    "cliente": { "nombre": "Juan Pérez", "tipo_doc": "CC|NIT|CE|PP", "num_doc": "1098...", "dv": "solo NIT" } }
  ```
- **Datos iniciales:** `npm run seed` crea el emisor (desde `EMISOR_*` del `.env`, o con
  marcadores para completar con `PUT /api/emisor`) y la secuencia interna.
- **Paso a la DIAN:** insertar una secuencia nueva con `prefijo`, `rango_desde/hasta`,
  `resolucion_numero/fecha` y `vigencia_hasta`, y desactivar la anterior. El PDF imprime la
  resolución cuando existe; al agotarse el rango o vencer la vigencia, no se emite y la venta se revierte.

### Anulación

`POST /api/facturas/:id/anular` (**solo administrador**: quien cobra no puede revertir sus propios cobros).
En una transacción: la factura pasa a `anulada` (con `motivo_anulacion`, obligatorio de al menos 10
caracteres, `fecha_anulacion` e `id_usuario_anulacion`), la venta pasa a `anulada` y el stock vuelve
como entradas con motivo `anulacion` en el Kardex. El número anulado **no** se reutiliza.

Con `reabrir_pedidos: true` (solo ventas de mesa), los pedidos vuelven a quedar abiertos y la mesa
`ocupada`, para volver a cobrarlos con los datos correctos y el mismo tratamiento tributario (en el
sitio, INC). Si la mesa ya tiene pedidos abiertos de otro cliente responde `409` y no cambia nada.
Una factura ya anulada responde `409`.

## Cómo se verificó cada criterio de aceptación del Backlog

**US-01 — Inicio de sesión seguro**
- Login válido → token + datos de usuario. Probado.
- Login inválido → `401` con mensaje genérico ("Usuario o contraseña incorrectos"), igual si el usuario no existe o si la contraseña es errónea, para no filtrar cuál de las dos falló. Probado.
- La contraseña se guarda con `bcryptjs` (10 salt rounds), nunca en texto plano. Verificado en `usuarioService.crearUsuario`.

**US-02 — Asignación de roles**
- Un usuario se crea con `administrador`, `mesero` o `cajero` (`usuarioService` valida contra esa lista). Probado.
- Un mesero recibe `403` en cada endpoint del módulo de inventario (`/api/productos`, `/api/proveedores`, `/api/categorias`, `/api/inventario/*`). Probado end-to-end.

**US-03 — Registro de trazabilidad**
- Cada creación de usuario queda en `log_auditoria` (usuario responsable, fecha/hora, entidad afectada) vía el middleware de auditoría — el controlador no tiene que acordarse de escribirlo. Probado.
- Un administrador puede consultar `/api/auditoria` y ver el historial. Probado.

**US-04 — Registrar productos**
- Crear/editar/consultar producto (nombre, categoría, unidad, precio, stock). El stock inicial se ve de inmediato en `GET /api/productos`. Probado.
- La edición no modifica `stock_actual` (solo cambia vía entradas/salidas) para no perder trazabilidad. Verificado en `productoService`.

**US-05 — Registrar proveedores**
- Crear proveedor (nombre, contacto). Probado.
- Un proveedor se asocia a uno o más productos vía `producto_proveedor` (`POST /api/proveedores/:id/productos`); el detalle del proveedor lista sus productos. Probado.

**US-06 — Entradas de inventario**
- Una entrada aumenta `stock_actual` en la cantidad indicada, en una transacción junto con el registro en `movimientos_inventario` (proveedor, usuario responsable y fecha). Probado (stock sube de 20 a 30 con una entrada de 10).

**US-07 — Salidas de inventario**
- Una salida disminuye `stock_actual`, con motivo (`venta`/`ajuste`), fecha y usuario responsable. No se permite sacar más stock del disponible. Probado.

**US-09 — Historial de movimientos**
- `GET /api/inventario/movimientos` filtra por `?id_producto=`, `?desde=` y `?hasta=`; cada movimiento muestra tipo, cantidad, usuario y fecha. Probado.

**US-08 — Alertas de stock bajo**
- `alerta_stock_bajo` (`stock_actual <= umbral_alerta`) se calcula en cada producto listado; `umbral_alerta` es configurable por producto vía `PUT /api/productos/:id`. `?bajo_stock=true` filtra solo los productos en alerta. Probado (un producto entra y sale de alerta al cambiar su stock o su umbral).

**US-10 — QR por mesa**
- Cada mesa se crea con un `codigo_qr_token` único (aleatorio, no expone `id_mesa`). `GET /api/mesas/:id/qr` devuelve la URL del catálogo y un PNG en base64 (`qrcode`), listo para imprimir desde `public/panel/mesas.html`. Probado.

**US-11 — Catálogo web por QR**
- `GET /api/catalogo/:token` devuelve el número de mesa y solo los productos con `stock_actual > 0` (sin `stock_actual` ni `umbral_alerta` en la respuesta). Un token inválido devuelve `404`. Probado (un producto con stock 0 no aparece en el listado).

**US-12 — Autopedido del cliente**
- `POST /api/catalogo/:token/pedidos` valida cada línea contra el producto real, copia `precio_unitario` al momento del pedido y crea `pedidos` + `pedido_detalle` en una transacción; la mesa pasa a `ocupada` si estaba `libre`. Rechaza pedidos vacíos y productos sin disponibilidad. Probado.

**US-13 — Panel de pedidos entrantes**
- `GET /api/pedidos?estado=pendiente` lista los pedidos con sus líneas; `public/panel/pedidos.html` los agrupa por mesa en el cliente y hace polling cada 5s (sin WebSockets, según lo definido en CLAUDE.md). `PUT /api/pedidos/:id/entregado` marca la entrega. Probado.

**US-14 — Cierre de cuenta por mesa**
- `POST /api/mesas/:id/cerrar-cuenta` consolida **todos** los pedidos abiertos de la mesa (`id_venta IS NULL`) en una única `venta`: crea la venta, copia cada línea de `pedido_detalle` a `venta_detalle`, marca cada pedido con su `id_venta` y libera la mesa — todo dentro de un `BEGIN/COMMIT/ROLLBACK` manual (`ventaModel.cerrarCuentaMesa`, mismo patrón que `movimientoInventarioModel`). Si la mesa no está `ocupada`, o no tiene pedidos pendientes de cobro, no se crea nada. Probado con dos pedidos de la misma mesa: el total sumó correctamente ambos, la mesa quedó `libre` y ambos pedidos quedaron con el mismo `id_venta`.

**US-15 — Venta rápida sin mesa**
- `POST /api/ventas` crea una venta `tipo: "mostrador"` con `id_mesa: null`; mismo esquema y mismo `venta_detalle` que una venta por mesa. Rechaza ventas sin items (`400`) y bloquea al mesero (`403`, solo administrador/cajero). Probado.

**US-16 — Descuento automático de inventario**
- El descuento **no es una función aparte**: `movimientoInventarioModel.descontarPorVenta` (sin transacción propia) se invoca desde dentro de la transacción de `ventaModel.crearVentaMostrador` (US-15) **y** de `ventaModel.cerrarCuentaMesa` (US-14), reutilizando la misma validación de stock suficiente que `registrarSalida` (US-07). Si una línea no tiene stock suficiente, toda la venta/cierre se revierte (`ROLLBACK`): probado con una venta de mostrador (200 unidades pedidas contra 50 en stock → `400`, stock intacto) y con un cierre de cuenta (5 unidades pedidas contra 3 en stock → `400`, la mesa siguió `ocupada` y el pedido siguió con `id_venta: null`). Cada descuento queda también en `movimientos_inventario` con `motivo: "venta"` e `id_venta` poblado.
- **Regresión de Sprint 3 repetida tras el cambio**: dos pedidos de la misma mesa (1 Ron + 2 Hielo, y 1 Ron + 1 Hielo) cerrados en una sola cuenta siguen consolidando en un total correcto ($120.000), la mesa vuelve a `libre` y ambos pedidos comparten `id_venta` — igual que en Sprint 3, ahora además con el stock descontado correctamente (Ron 5→3, Hielo 47→44).

**US-17 — Reporte de ventas**
- `GET /api/ventas?desde=&hasta=&tipo=` filtra por rango de fechas y diferencia `mesa` de `mostrador` vía el campo `tipo` (ya existente en el esquema). Bloqueado para mesero. Probado.

**US-18 — Reporte de movimientos de inventario**
- Se reutilizó `GET /api/inventario/movimientos` de Sprint 2 (no se creó un endpoint nuevo): solo se le agregó el filtro `?id_usuario=` que faltaba, en el modelo, servicio y controlador. Ya mostraba tipo, cantidad, producto, fecha y usuario. Probado combinado con `?id_producto=`.

**US-14b — Notificación de nuevo pedido (opcional, implementada)**
- `public/panel/pedidos.html` compara, en cada poll de 5s, los `id_pedido` recibidos contra los vistos en el poll anterior; los que no estaban se resaltan con una franja de color y una etiqueta "NUEVO". Sin WebSockets, solo polling.

**US-19 — Exportación de reportes (opcional, implementada)**
- `GET /api/ventas?formato=csv` y `GET /api/inventario/movimientos?formato=csv` devuelven el mismo listado filtrado ya soportado, serializado como CSV (`src/utils/csv.js`, compartido entre ambos reportes) con `Content-Disposition: attachment`. El modo JSON normal (sin `?formato=csv`) no cambió. Probado con y sin filtros.

## Sprint 4 completo

No queda pendiente ninguna historia del Backlog Priorizado (US-01 a US-19).
