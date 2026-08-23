# Licorería — Backend (Sprint 1 + Sprint 2 + Sprint 3)

Sprint 1 implementa US-01, US-02 y US-03 (RF-01 a RF-03). Sprint 2 agrega
US-04 a US-09 (RF-04 a RF-09, Módulo de Inventario). Sprint 3 agrega US-10 a
US-14 (RF-10 a RF-14, Mesas y Pedidos por QR). Todo sobre la arquitectura
y el modelo de datos definidos en `08_Modelo_de_Datos_y_Arquitectura.docx`.

## Instalación

```bash
npm install
cp .env.example .env        # y cambia JWT_SECRET por un valor propio
npm run seed                # crea el primer administrador y las categorías iniciales
npm start                   # http://localhost:3000
```

La base de datos usa `node:sqlite` (nativo desde Node 22.5, sin flags desde
Node 22.13/23.4). Se eligió sobre `better-sqlite3` porque este último requiere
compilar un binario nativo (node-gyp + Python + build tools de C++), que no
están disponibles en todos los entornos de desarrollo. Requiere Node 22.5+.

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
                  pedidoController
  middlewares/   auth.js (JWT), roles.js (RBAC), auditoria.js (bitácora automática)
  routes/        auth, usuarios, auditoria, categorias, productos, proveedores,
                  inventario (entradas/salidas/historial), mesas, catalogo (público),
                  pedidos
  app.js / server.js
public/panel/    login.html, mesas.html (crear mesas / imprimir QR), pedidos.html
                  (panel de pedidos entrantes, con polling) — panel mínimo para
                  probar el flujo a mano
public/catalogo/ index.html — catálogo público del cliente (sin login), abierto
                  al escanear el QR de una mesa
```

Sprint 1, 2 y 3 ya tienen lógica de negocio completa. El resto de tablas del
modelo (ventas de mostrador para Sprint 4) ya existen en `schema.sql` para que
los próximos sprints no tengan que tocar el esquema, solo agregar sus propios
modelos/servicios/rutas.

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
| GET | `/api/inventario/movimientos` | administrador, cajero | RF-09. Historial filtrable por `?id_producto=`, `?desde=`, `?hasta=`. |
| POST | `/api/mesas` | administrador | RF-10. Crea una mesa (`numero`); genera `codigo_qr_token` único. |
| GET | `/api/mesas` | administrador, mesero, cajero | Lista mesas con su estado (`libre`/`ocupada`). |
| GET | `/api/mesas/:id` | administrador, mesero, cajero | Detalle de una mesa. |
| GET | `/api/mesas/:id/qr` | administrador, mesero, cajero | RF-10. Devuelve `{ url, qr_data_url }` (PNG en base64) para imprimir. |
| POST | `/api/mesas/:id/cerrar-cuenta` | administrador, cajero | RF-14. Consolida los pedidos abiertos de la mesa en una venta y libera la mesa (transacción). |
| GET | `/api/catalogo/:token` | público (sin login) | RF-11. Catálogo de la mesa identificada por su `codigo_qr_token`; solo productos con `stock_actual > 0`, sin exponer el stock exacto. |
| POST | `/api/catalogo/:token/pedidos` | público (sin login) | RF-12. Autopedido del cliente (`items: [{ id_producto, cantidad }]`); asocia el pedido a la mesa del token y la marca `ocupada`. |
| GET | `/api/pedidos` | administrador, mesero, cajero | RF-13. Panel de pedidos entrantes, filtrable por `?estado=` y `?id_mesa=`. |
| PUT | `/api/pedidos/:id/entregado` | administrador, mesero, cajero | Marca un pedido como entregado. |

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

## Pendiente para Sprint 4

Venta rápida sin mesa, descuento automático de inventario y reportes
(US-15 a US-19) — `ventaModel` ya existe y `VENTA_DETALLE` ya es la fuente
única de líneas vendidas, así que Sprint 4 solo agrega el flujo de venta de
mostrador y la lógica de reportes/exportación sobre las tablas existentes.
