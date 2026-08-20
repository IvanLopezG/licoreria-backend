# Licorería — Backend (Sprint 1 + Sprint 2)

Sprint 1 implementa US-01, US-02 y US-03 (RF-01 a RF-03). Sprint 2 agrega
US-04 a US-09 (RF-04 a RF-09, Módulo de Inventario). Todo sobre la arquitectura
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

## Estructura

```
src/
  db/            conexión SQLite (node:sqlite) + schema.sql (las 12 tablas del modelo completo)
  models/        usuarioModel, logAuditoriaModel, categoriaModel, productoModel,
                  proveedorModel, movimientoInventarioModel
  services/      authService, usuarioService, categoriaService, productoService,
                  proveedorService, movimientoInventarioService
  controllers/   authController, usuarioController, auditoriaController,
                  categoriaController, productoController, proveedorController,
                  movimientoInventarioController
  middlewares/   auth.js (JWT), roles.js (RBAC), auditoria.js (bitácora automática)
  routes/        auth, usuarios, auditoria, categorias, productos, proveedores,
                  inventario (entradas/salidas/historial)
  app.js / server.js
public/panel/    login.html — panel mínimo para probar el flujo a mano
```

Sprint 1 y 2 ya tienen lógica de negocio completa. El resto de tablas del
modelo (mesas, ventas, pedidos, etc.) ya existen en `schema.sql` para que los
próximos sprints no tengan que tocar el esquema, solo agregar sus propios
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

## Pendiente para Sprint 3

Mesas, QR por mesa, catálogo público y pedidos (US-10 a US-14) — las tablas
`mesas`, `pedidos` y `pedido_detalle` ya existen en `schema.sql`, falta su
lógica de negocio.
