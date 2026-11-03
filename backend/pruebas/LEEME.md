# Pruebas de EntreLazados

| | Carpeta | Qué necesitan | Comando (desde `backend/`) |
|---|---|---|---|
| **Unitarias** (58) | `pruebas/unidad/` | Nada (ni MySQL ni `.env`) | `npm run test:unidad` |
| **De integración** (274) | `pruebas/pruebas_api.js` | La base MySQL de pruebas (paso 1) | `npm run test:api` |
| **Todas** | | La base de pruebas | `npm test` |

En GitHub se corren solas en cada push y pull request (ver `.github/workflows/pruebas.yml`
en la raíz del repositorio y la pestaña **Actions**).

## Pruebas unitarias

Usan `node:test`, el corredor de pruebas que trae Node (no hay que instalar nada). Node encuentra
solo los archivos que terminan en `.test.js`:

| Archivo | Qué prueba |
|---|---|
| `utilidades.test.js` | Validaciones de correo y token, paginación, búsquedas con `%` y `_`, ocultar correos |
| `reglas_negocio.test.js` | Validar una publicación, la máquina de estados de los tratos, las respuestas fijas de Kan |
| `middlewares.test.js` | Sesión (tokens falsos, vencidos, cuenta suspendida), roles y el manejador de errores |
| `app.test.js` | La aplicación Express completa con una base de datos falsa: 404, 401, JSON mal escrito, Swagger, archivos que no se pueden descargar |
| `rutas_documentadas.test.js` | Que cada ruta del código esté en `entrelazados-api/docs/openapi.yaml` y viceversa |

`ayudas.js` no es una prueba: tiene una respuesta de Express falsa y una función para silenciar
los mensajes del log mientras corre una prueba.

```bash
npm run test:unidad          # ~1 segundo
npm run test:cobertura       # además muestra qué líneas del código se recorrieron (Node 22)
node --test --test-reporter=spec   # salida con ✔ / ✖ por prueba
```

**Si falla `rutas_documentadas`** después de agregar una ruta: falta describirla en
`entrelazados-api/docs/openapi.yaml` (se ve en `/api/docs`).

---

# Pruebas de integración de la API

Pruebas de integración que levantan el flujo completo (registro, login, ofertas,
confirmación del correo, editar y paginar ofertas, fotos, subastas, pujas, cierre de
subastas, seguimiento y calificación de tratos, chat y mensajes no leídos, perfil,
panel de administrador, restablecer contraseña y límites de intentos) contra una
base MySQL **local** de pruebas. Nunca usan la base de producción.

## 1. Crear la base de pruebas (una sola vez, como root en MySQL Workbench)

```sql
CREATE DATABASE entrelazados_pruebas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'entrelazados_pruebas'@'localhost' IDENTIFIED BY 'UNA_CLAVE_DE_PRUEBA';
GRANT ALL PRIVILEGES ON entrelazados_pruebas.* TO 'entrelazados_pruebas'@'localhost';
```

## Forma rápida: `npm run test:api`

Con la base del paso 1 creada, desde `backend/`:

```bash
CLAVE_PRUEBAS=UNA_CLAVE_DE_PRUEBA npm run test:api     # solo estas
CLAVE_PRUEBAS=UNA_CLAVE_DE_PRUEBA npm test             # unitarias + estas
```

`pruebas/correr_pruebas.js` hace solo los pasos 2 a 4: vacía `entrelazados_pruebas`, carga el
esquema, levanta el servidor en el puerto 3055 con las variables de prueba, corre las 274
pruebas y apaga el servidor. Termina con `RESULTADO: 274 correctas, 0 fallidas` (y código de
salida 0). Se puede repetir las veces que quieras.

En PowerShell: `$env:CLAVE_PRUEBAS="UNA_CLAVE_DE_PRUEBA"; npm test`

Si MySQL no está en `localhost`, indica dónde con `PRUEBAS_DB_HOST` (GitHub Actions usa `127.0.0.1`).

Los pasos 2 a 4 explican lo mismo a mano.

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
LIMITE_API=2000 VERIFICAR_CORREO=1 EMAIL_USER= EMAIL_PASS= \
INTERVALO_CIERRE_SUBASTAS_SEG=3600 node index.js
```

Los límites se suben porque las pruebas crean muchas cuentas y hacen cientos de peticiones desde la
misma IP. `VERIFICAR_CORREO=1` obliga a confirmar el correo aunque no haya correo configurado: las
pruebas leen el enlace de la base de datos (y el servidor lo escribe en su log). La sección 15
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
