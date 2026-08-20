# Licorería — Backend (Sprint 1: Módulo de Autenticación y Usuarios)

Implementa US-01, US-02 y US-03 del Backlog (RF-01 a RF-03), sobre la arquitectura
y el modelo de datos definidos en `08_Modelo_de_Datos_y_Arquitectura.docx`.

## Instalación

```bash
npm install
cp .env.example .env        # y cambia JWT_SECRET por un valor propio
npm run seed                # crea el primer administrador (ver .env para usuario/clave)
npm start                   # http://localhost:3000
```

Panel de prueba en el navegador: **http://localhost:3000/panel/login.html**

## Estructura

```
src/
  db/            conexión SQLite + schema.sql (las 12 tablas del modelo completo)
  models/        usuarioModel, logAuditoriaModel
  services/      authService (login), usuarioService (alta de usuarios)
  controllers/   authController, usuarioController, auditoriaController
  middlewares/   auth.js (JWT), roles.js (RBAC), auditoria.js (bitácora automática)
  routes/        auth, usuarios, auditoria, inventario (placeholder de Sprint 2)
  app.js / server.js
public/panel/    login.html — panel mínimo para probar el flujo a mano
```

Solo se implementó lógica de negocio para Auth (Sprint 1). El resto de tablas del
modelo ya existen en `schema.sql` para que los próximos sprints no tengan que
tocar el esquema, solo agregar sus propios modelos/servicios/rutas.

## Endpoints

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | público | RF-01. Devuelve `{ token, usuario }`. |
| GET | `/api/auth/me` | autenticado | Info del usuario del token actual. |
| POST | `/api/usuarios` | administrador | RF-02. Crea un usuario (hash bcrypt). |
| GET | `/api/usuarios` | administrador | Lista usuarios (sin password_hash). |
| GET | `/api/auditoria` | administrador | RF-03. Bitácora, filtrable por `?id_usuario=` y `?entidad=`. |
| GET | `/api/inventario/ping` | administrador, cajero | Placeholder de Sprint 2, solo para probar RBAC. |

## Cómo se verificó cada criterio de aceptación del Backlog

**US-01 — Inicio de sesión seguro**
- Login válido → token + datos de usuario. Probado.
- Login inválido → `401` con mensaje genérico ("Usuario o contraseña incorrectos"), igual si el usuario no existe o si la contraseña es errónea, para no filtrar cuál de las dos falló. Probado.
- La contraseña se guarda con `bcryptjs` (10 salt rounds), nunca en texto plano. Verificado en `usuarioService.crearUsuario`.

**US-02 — Asignación de roles**
- Un usuario se crea con `administrador`, `mesero` o `cajero` (`usuarioService` valida contra esa lista). Probado.
- Un mesero recibe `403` al llamar `/api/inventario/ping` (ruta restringida a administrador/cajero). Probado end-to-end.

**US-03 — Registro de trazabilidad**
- Cada creación de usuario queda en `log_auditoria` (usuario responsable, fecha/hora, entidad afectada) vía el middleware de auditoría — el controlador no tiene que acordarse de escribirlo. Probado.
- Un administrador puede consultar `/api/auditoria` y ver el historial. Probado.

## Pendiente para Sprint 2

Los modelos/servicios de `productos`, `proveedores`, `movimientos_inventario`, etc.
todavía no existen — solo las tablas en `schema.sql`. `/api/inventario/ping` es un
stub temporal, se reemplaza por las rutas reales de RF-04 a RF-09.
