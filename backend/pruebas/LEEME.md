# Pruebas locales de la API

Pruebas de integración que levantan el flujo completo (registro, login, ofertas,
subastas, pujas, chat, perfil, panel de administrador y restablecer contraseña)
contra una base MySQL **local** de pruebas. Nunca usan la base de producción.

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

## 3. Levantar el servidor apuntando a la base de pruebas

Desde `backend/entrelazados-api` (las variables de la línea de comandos tienen
prioridad sobre el `.env`, que no se modifica):

```bash
DB_HOST=localhost DB_USER=entrelazados_pruebas DB_PASSWORD=UNA_CLAVE_DE_PRUEBA \
DB_NAME=entrelazados_pruebas GEMINI_API_KEY=sin-clave PORT=3055 node index.js
```

## 4. Ejecutar las pruebas (en otra terminal, desde `backend`)

```bash
node pruebas/pruebas_api.js "$(pwd)" UNA_CLAVE_DE_PRUEBA
```

Las pruebas esperan una base **recién cargada**: para repetirlas, borra y vuelve a
crear `entrelazados_pruebas` y repite el paso 2.
