# Pruebas locales de la API

Pruebas de integración que levantan el flujo completo (registro, login, ofertas,
fotos, subastas, pujas, cierre de subastas, seguimiento de tratos, chat, perfil,
panel de administrador, restablecer contraseña y límites de intentos) contra una
base MySQL **local** de pruebas. Nunca usan la base de producción.

## 1. Crear la base de pruebas (una sola vez, como root en MySQL Workbench)

```sql
CREATE DATABASE entrelazados_pruebas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'entrelazados_pruebas'@'localhost' IDENTIFIED BY 'UNA_CLAVE_DE_PRUEBA';
GRANT ALL PRIVILEGES ON entrelazados_pruebas.* TO 'entrelazados_pruebas'@'localhost';
```

## 2. Cargar el esquema y los datos iniciales

Desde la carpeta `backend`:

```bash
node pruebas/cargar_esquema.js "$(pwd)" "$(pwd)/sql/esquema_mysql.sql" UNA_CLAVE_DE_PRUEBA
```

Crea las tablas, un administrador (`admin@prueba.com` / `Admin123!`) y un usuario
antiguo con contraseña sin cifrar (`antiguo@prueba.com` / `clave_vieja`).

### (Opcional) Datos de demostración para el dashboard

Para ver el dashboard con 8 meses de actividad (10 proveedores, 18 emprendedores,
42 ofertas, ~160 pujas y mensajes), después del paso 2 ejecuta:

```bash
node pruebas/datos_demo.js "$(pwd)" UNA_CLAVE_DE_PRUEBA
```

Cuentas: `proveedor1@demo.com` … `proveedor10@demo.com` y `emprendedor1@demo.com` …
`emprendedor18@demo.com`, todas con la contraseña `Demo1234`.
(Si cargas los datos demo, `pruebas_api.js` ya no aplica: necesita la base vacía.)

## 3. Levantar el servidor apuntando a la base de pruebas

Desde `backend/entrelazados-api` (las variables de la línea de comandos tienen
prioridad sobre el `.env`, que no se modifica):

```bash
DB_HOST=localhost DB_USER=entrelazados_pruebas DB_PASSWORD=UNA_CLAVE_DE_PRUEBA \
DB_NAME=entrelazados_pruebas GEMINI_API_KEY=sin-clave JWT_SECRET=secreto-de-pruebas PORT=3055 \
UPLOADS_DIR=/tmp/uploads_pruebas LIMITE_REGISTRO=40 LIMITE_RECUPERACION=30 LIMITE_LOGIN=30 \
INTERVALO_CIERRE_SUBASTAS_SEG=3600 node index.js
```

Los límites se suben porque las pruebas crean muchas cuentas desde la misma IP. La sección 15
comprueba igual que los límites funcionan: sigue intentando hasta recibir el 429. El cierre de
subastas se pone cada hora para que las pruebas lo controlen con
`POST /api/admin/subastas/cerrar-vencidas`. Las fotos de prueba quedan en `UPLOADS_DIR` y se pueden
borrar al terminar.

## 4. Ejecutar las pruebas (en otra terminal, desde `backend`)

```bash
node pruebas/pruebas_api.js "$(pwd)" UNA_CLAVE_DE_PRUEBA
```

Las pruebas esperan una base **recién cargada**: para repetirlas, borra y vuelve a
crear `entrelazados_pruebas` y repite el paso 2.
