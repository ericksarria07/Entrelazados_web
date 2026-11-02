# 🧵 EntreLazados

**EntreLazados** es un mercado en línea de **insumos y materia prima para artesanos del cuero y el calzado en Nicaragua**. Conecta a **proveedores** de cuero, herrajes, suelas, pegamentos y otros materiales con **emprendedores** que fabrican calzado y artículos de cuero.

Los proveedores publican sus materiales, y cada publicación abre una subasta. Los emprendedores comparan precios por cercanía, pujan y negocian por chat. **Kan**, el asistente virtual (con Google Gemini), orienta a los usuarios dentro de la plataforma.

> Sitio en producción: `http://57.156.69.249:3000` (VM de Azure)

---

## Funcionalidades

### Proveedor
- Publica materiales con título, precio, unidad, categoría y **hasta 5 fotos**. Las fotos se reducen en el navegador antes de subirlas (una foto de celular de 5 MB queda en unos 400 KB).
- Cada publicación crea automáticamente una **subasta** de 7 días con el mismo precio base, que muestra sus fotos.
- **Crear subastas** desde el Mercado: de una de sus publicaciones o de un lote nuevo, de 3 a 14 días.
- **Edita** sus publicaciones (título, precio, unidad, categoría y fotos): si tienen una subasta abierta, esta toma el título y la categoría nuevos.
- Elimina sus publicaciones: si su subasta sigue abierta y sin pujas, se **cancela** con ella. Si ya tiene pujas, hay que esperar a que cierre (el administrador sí puede retirarla y se avisa por el chat a quienes pujaron).
- Las **categorías** de los formularios y del buscador salen de la base de datos: una categoría nueva del administrador aparece sola.
- Ve su actividad en el dashboard: ofertas, subastas, pujas recibidas y **subastas vendidas**.

### Emprendedor
- **Mercado** con búsqueda, filtros por categoría y radio de cercanía (km), **páginas** de 10 ofertas y mapa interactivo. Cada oferta muestra al proveedor y su **calificación**.
- **Contactar Proveedor** abre directamente el chat con quien publicó.
- **Subastas**: puja por encima del precio actual. La validación es atómica: dos pujas simultáneas nunca dejan un precio menor.
- **Subastas ganadas** en el dashboard, con un botón para coordinar la entrega por chat.

### Seguimiento de tratos
Cada subasta ganada es un trato que proveedor y comprador avanzan desde el dashboard:

`Pendiente` → `En proceso` (pago y entrega acordados) → `Completado`, o `Cancelado` (con motivo opcional) mientras no esté completado.

Cualquiera de los dos puede cambiarlo; la otra parte recibe un aviso automático en el chat y un correo. Los tratos cancelados no cuentan en "subastas ganadas / vendidas".

### Calificaciones
Al completar un trato, cada parte califica a la otra **una vez** (1 a 5 estrellas y un comentario opcional). El promedio aparece junto al proveedor en el Mercado y como "Mi calificación" en el dashboard.

### Administrador
- Métricas de la plataforma, lista de usuarios **con búsqueda y páginas**, suspender o reactivar cuentas, eliminar usuarios o publicaciones y crear categorías.
- **Correos con problemas**: el panel avisa de las cuentas con un correo inválido (p. ej. `erick@gmail`, que no pueden entrar) o sin confirmar, y permite **corregir el correo** o darlo por confirmado.
- Si retira una publicación o da de baja a un proveedor con subastas abiertas, quienes pujaron reciben un aviso en el chat (y por correo).

### Cierre automático de subastas
Cada minuto el servidor cierra las subastas vencidas. Si hubo pujas, gana la más alta:
- la subasta pasa a `Finalizada` y el trato queda registrado en `TratosCerrados` (estado `Pendiente`);
- se abre el chat entre proveedor y ganador con un mensaje automático;
- ambos reciben un correo (si el correo está configurado). Si no hubo pujas, el proveedor recibe un aviso.

### Para todos
- **Dashboard** con 8 indicadores, gráficas (Chart.js), precios de referencia por categoría, subastas en curso y **exportación a Excel** (6 hojas).
- **Kan**, el asistente virtual con IA.
- **Chat** directo entre proveedores y emprendedores, con **contador de mensajes no leídos** en el menú de todas las páginas y en cada contacto, y la marca "Visto".
- **Confirmación del correo al registrarse**: enlace de 24 horas; sin confirmarlo no se puede entrar (se puede pedir otro enlace desde el login).
- **Recuperación de contraseña por correo**: enlace de un solo uso que vence en 1 hora.
- Diseño adaptado a celular.

---

## Tecnologías

| Parte | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript sin frameworks; Chart.js, ExcelJS, Leaflet, Tabler Icons |
| Backend | Node.js 22 + Express 5 |
| Base de datos | MySQL 8 (`mysql2`) |
| Seguridad | `bcrypt` (contraseñas), `jsonwebtoken` (sesiones), `dotenv` (claves), `express-rate-limit` (límite de intentos) |
| Fotos | `multer` (recibir archivos); se guardan en disco, no en la base de datos |
| Correo | `nodemailer` (Gmail con contraseña de aplicación u otro SMTP) |
| IA | `@google/genai` (Gemini) |
| Producción | VM Ubuntu 24.04 en Azure, PM2 y MySQL en la misma máquina |

---

## Estructura del proyecto

```text
Entrelazados_web/
├── README.md
└── backend/
    ├── package.json              # dependencias (npm install se ejecuta aquí)
    ├── entrelazados-api/
    │   ├── index.js              # servidor Express: API + archivos de public/
    │   ├── correo.js             # envío de correos (recuperación y avisos de subastas)
    │   ├── limites.js            # límites de intentos (login, registro, Kan...)
    │   ├── fotos.js              # recibir, validar, guardar y borrar fotos
    │   ├── subastas.js           # cierre automático de subastas vencidas
    │   ├── tratos.js             # estados de los tratos (pendiente → completado)
    │   ├── uploads/              # fotos subidas (NO se sube a git; va en los respaldos)
    │   ├── .env.example          # plantilla de variables de entorno
    │   ├── .env                  # claves reales (NO se sube a git)
    │   └── public/               # lo único que ve el navegador
    │       ├── preview.html      # portada pública (página de inicio)
    │       ├── login.html, unirse.html, restablecer.html, verificar.html
    │       ├── index.html        # inicio con sesión
    │       ├── mercado.html, chat.html, perfil.html
    │       ├── dashboard.html, admin.html
    │       ├── sesion.js         # agrega el token a cada petición /api y cuenta los mensajes no leídos
    │       ├── categorias.js     # llena los <select> de categorías desde la API
    │       ├── styles.css
    │       └── *.webp, logo.png  # imágenes
    ├── sql/
    │   ├── esquema_mysql.sql     # crea la base completa desde cero
    │   ├── migracion_v7.sql      # rol Administrador
    │   ├── migracion_v8.sql      # fotos en disco y cierre de subastas
    │   ├── migracion_v9.sql      # subastas ligadas a su publicación, estado Cancelada
    │   └── migracion_v10.sql     # confirmar correo, calificaciones, mensajes no leídos
    ├── scripts/
    │   ├── LEEME.md              # respaldos, correo y clave de Gemini en la VM
    │   ├── respaldo.sh           # respaldo de MySQL + fotos (rota a los 7 días)
    │   ├── restaurar.sh          # restaurar un respaldo
    │   ├── instalar_cron.sh      # programa el respaldo diario
    │   ├── configurar_correo.sh  # guarda EMAIL_USER / EMAIL_PASS / APP_URL y manda una prueba
    │   └── probar_gemini.js      # comprueba la clave de Gemini (Kan)
    └── pruebas/
        ├── LEEME.md              # cómo correr las pruebas
        ├── pruebas_api.js        # 274 pruebas de integración
        ├── cargar_esquema.js
        └── datos_demo.js         # datos de ejemplo para el dashboard
```

---

## Instalación local

### Requisitos
- [Node.js](https://nodejs.org) 20 o superior
- MySQL 8

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/ericksarria07/Entrelazados_web.git
cd Entrelazados_web/backend
npm install
```

### 2. Crear la base de datos

En MySQL (Workbench o consola), como root:

```sql
CREATE DATABASE entrelazadosdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'entrelazados_app'@'localhost' IDENTIFIED BY 'una_contraseña_segura';
GRANT ALL PRIVILEGES ON entrelazadosdb.* TO 'entrelazados_app'@'localhost';
```

Después carga las tablas y las 15 categorías de materiales (los departamentos se crean solos cuando alguien se registra):

```bash
mysql -u entrelazados_app -p entrelazadosdb < sql/esquema_mysql.sql
```

Si ya tienes una base de una versión anterior, en lugar del esquema completo aplica las migraciones que te falten, en orden: `sql/migracion_v7.sql`, `sql/migracion_v8.sql`, `sql/migracion_v9.sql` y `sql/migracion_v10.sql`.

### 3. Configurar el `.env`

Copia la plantilla y llena los valores:

```bash
cp entrelazados-api/.env.example entrelazados-api/.env
```

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Sí | Conexión a MySQL |
| `JWT_SECRET` | Sí | Firma las sesiones. Genera una con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GEMINI_API_KEY` | No | Clave de Google AI Studio para Kan. Sin ella, Kan solo contesta sus preguntas frecuentes predefinidas. Se prueba con `node backend/scripts/probar_gemini.js` |
| `GEMINI_MODELO` | No | Modelo de Gemini (por defecto `gemini-3.8-flash`) |
| `EMAIL_USER`, `EMAIL_PASS` | No | Cuenta de Gmail y [contraseña de aplicación](https://myaccount.google.com/apppasswords) para enviar los correos de recuperación |
| `EMAIL_HOST`, `EMAIL_PORT` | No | Solo si usas otro servidor SMTP en lugar de Gmail |
| `APP_URL` | No | Dirección pública del sitio para los enlaces de los correos |
| `VERIFICAR_CORREO` | No | `1` exige confirmar el correo al registrarse, `0` no. Vacío: se exige solo si el correo está configurado |
| `LIMITE_LOGIN`, `LIMITE_REGISTRO`, `LIMITE_KAN_MINUTO`… | No | Cambiar los límites de intentos (valores por defecto en `.env.example`) |
| `UPLOADS_DIR` | No | Carpeta de las fotos (por defecto `entrelazados-api/uploads`) |
| `TRUST_PROXY` | No | `1` solo si pones nginx delante, para que los límites vean la IP real |
| `CORS_ORIGENES` | No | Otros sitios que pueden usar la API. Vacío = solo el propio sitio |

Si falta una variable obligatoria, el servidor no arranca y dice cuál falta. Si no configuras el correo, el enlace de recuperación se escribe en el log del servidor.

> ⚠️ Nunca subas el `.env` a GitHub. Ya está en el `.gitignore`.

### 4. Arrancar

```bash
cd entrelazados-api
node index.js
```

Abre http://localhost:3000.

Para crear el primer administrador, registra una cuenta normal y cambia su rol en MySQL:

```sql
UPDATE Usuarios SET TipoRol = 'Administrador' WHERE CorreoElectronico = 'tu_correo@ejemplo.com';
```

Para comprobar el envío de correos sin usar la página:

```bash
node correo.js tu_correo@gmail.com
```

---

## Pruebas

Hay 274 pruebas de integración que recorren registro y confirmación del correo, login, ofertas (publicar, editar, paginar y filtrar), fotos, subastas (crear, cancelar y cerrar, con aviso a quienes pujaron), pujas, seguimiento y calificación de tratos, chat y mensajes no leídos, perfil, panel de administrador (incluida la corrección de correos), recuperación de contraseña y límites de intentos. Usan una base MySQL **aparte** (`entrelazados_pruebas`) y nunca tocan la real.

Las instrucciones completas están en [`backend/pruebas/LEEME.md`](backend/pruebas/LEEME.md). Ahí también se explica cómo cargar datos de demostración para ver el dashboard con información.

---

## Seguridad

- **Contraseñas** cifradas con bcrypt. Las cuentas antiguas en texto plano se cifran solas al iniciar sesión.
- **Sesiones con JWT** (8 horas). En cada petición se consulta el rol y el estado actuales, así que una cuenta suspendida pierde el acceso al instante.
- Las rutas usan el usuario del token, **nunca un id enviado por el navegador**. Solo los proveedores publican y solo los emprendedores pujan.
- **Consultas SQL parametrizadas** contra inyección SQL, y **escape de HTML** contra XSS.
- Recuperación de contraseña: 1 solicitud por minuto por correo, la misma respuesta exista o no la cuenta, y enlace de un solo uso.
- **Límites de intentos**: 10 logins fallidos cada 15 min por IP, 5 cuentas por hora, 5 recuperaciones cada 15 min, y Kan con 10 preguntas por minuto y 150 al día por usuario. Al pasarse, responde 429 con el tiempo de espera.
- **Kan** solo responde con sesión iniciada y toma el rol del token, así nadie de fuera gasta la cuota de Gemini.
- **Fotos**: máximo 5 por oferta y 5 MB cada una. El tipo real se comprueba por el contenido del archivo (no por la extensión) y el nombre lo pone el servidor.
- **CORS cerrado**: la API solo acepta peticiones de las páginas del propio sitio.
- Solo la carpeta `public/` es accesible desde el navegador.

---

## API

Todas las rutas responden JSON. 🔒 = requiere `Authorization: Bearer <token>` (lo agrega `sesion.js` automáticamente).

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/registro` | Crear cuenta (Proveedor o Emprendedor). Si hay que confirmar el correo responde `verificacionPendiente: true` |
| GET | `/api/verificar-correo?token=` | Confirmar el correo con el enlace recibido |
| POST | `/api/reenviar-verificacion` | Pedir otro enlace de confirmación `{ email }` |
| POST | `/api/login` | Iniciar sesión; devuelve el token |
| POST | `/api/solicitar-recuperacion` | Enviar el enlace para restablecer la contraseña |
| GET | `/api/validar-token-recuperacion` | Comprobar si un enlace sigue vigente |
| POST | `/api/restablecer-password` | Guardar la nueva contraseña |
| GET | `/api/ofertas`, `/api/subastas`, `/api/categorias`, `/api/estadisticas` | Datos públicos del mercado. Filtros `q`, `categoria` (y en ofertas `maxKm`, `proveedorId`). Con `?pagina=N&porPagina=M` responden `{ datos, total, pagina, porPagina, paginas }` |
| POST | `/api/ofertas` 🔒 | Publicar material (proveedor). JSON, o `multipart/form-data` con hasta 5 archivos en `fotos` |
| PUT | `/api/ofertas/:id` 🔒 | Editar una publicación propia (o cualquiera si eres admin). Mismos campos que al publicar, más `fotosQuitar` y fotos nuevas |
| DELETE | `/api/ofertas/:id` 🔒 | Eliminar una publicación propia (cancela su subasta abierta; 409 si ya tiene pujas) |
| POST | `/api/subastas` 🔒 | Crear una subasta: `{ precioBase, dias, ofertaId }` o `{ tituloLote, precioBase, categoriaId, dias }` (proveedor) |
| POST | `/api/pujas` 🔒 | Pujar en una subasta (emprendedor) |
| GET | `/api/chat/contactos`, `/api/chat/mensajes` 🔒 | Conversaciones propias (primero las que tienen mensajes sin leer). Abrir una conversación marca sus mensajes como leídos |
| GET | `/api/chat/no-leidos` 🔒 | `{ total, porContacto }` mensajes sin leer |
| POST | `/api/chat/enviar` 🔒 | Enviar un mensaje |
| POST | `/api/chat/ia` 🔒 | Preguntar a Kan |
| GET | `/api/tratos` 🔒 | Mis subastas ganadas o vendidas (primero las abiertas) |
| PUT | `/api/tratos/:id/estado` 🔒 | `{ estado: 'EnProceso' \| 'Completado' \| 'Cancelado', motivo? }` (solo las dos partes del trato) |
| POST | `/api/tratos/:id/calificacion` 🔒 | `{ puntuacion: 1-5, comentario? }` una vez por persona, solo tratos completados |
| GET | `/api/usuarios/:id/reputacion` 🔒 | Promedio, total y últimas calificaciones recibidas |
| GET | `/api/perfil/:id` 🔒 | Perfil propio (o cualquiera si eres admin) |
| GET | `/api/dashboard` 🔒 | Datos del dashboard según el rol |
| GET/PUT/DELETE/POST | `/api/admin/...` 🔒 | Panel de administrador (solo admin). `GET /api/admin/usuarios?pagina=&buscar=&problemas=1` |
| PUT | `/api/admin/usuarios/:id/correo` 🔒 | Corregir el correo de una cuenta `{ correo }` (solo admin) |
| PUT | `/api/admin/usuarios/:id/verificar` 🔒 | Dar por confirmado el correo de una cuenta (solo admin) |
| POST | `/api/admin/subastas/cerrar-vencidas` 🔒 | Cerrar ya las subastas vencidas, sin esperar al minuto (solo admin) |

---

## Despliegue en Azure

| | |
|---|---|
| Servidor | VM Ubuntu 24.04 en Microsoft Azure |
| Carpeta | `~/entrelazados` (clon de este repositorio) |
| Proceso | PM2, proceso `0`, puerto `3000` |
| Base de datos | MySQL en la misma VM (`entrelazadosdb`, usuario `entrelazados_app`) |
| Puertos abiertos | 22 (SSH) y 3000 (web), en el NSG de Azure y en `ufw` |

### Actualizar producción

```bash
ssh <usuario>@57.156.69.249
cd ~/entrelazados
git pull
cd backend && npm install          # solo si cambiaron las dependencias
pm2 restart 0 --update-env
pm2 logs 0 --lines 30              # revisar que arrancó bien
```

Si un cambio trae un archivo nuevo en `sql/`, aplícalo antes de reiniciar (el usuario `entrelazados_app` no tiene permiso para cambiar tablas, por eso se usa `sudo mysql`):

```bash
sudo mysql entrelazadosdb < backend/sql/<archivo>.sql
```

Los pasos exactos para pasar a la versión 10 están en [`backend/scripts/LEEME.md`](backend/scripts/LEEME.md#actualizar-a-la-versión-10).

### Respaldos

`backend/scripts/respaldo.sh` guarda cada día la base de datos y las fotos en `~/respaldos/entrelazados` y conserva 7 días. Cómo programarlo con `cron` y cómo restaurar: [`backend/scripts/LEEME.md`](backend/scripts/LEEME.md).

> Las fotos viven en `backend/entrelazados-api/uploads/` en la VM: `git pull` no las toca, pero si se pierde la VM solo quedan las de los respaldos.

---

## Flujo de trabajo con git

- Se trabaja en la rama **`main`** y se pasa a **`master`** (rama principal) con un *pull request*.
- Antes de subir cambios, corre las pruebas (`backend/pruebas/LEEME.md`).

---

## Autor

**Erick Sarria** · [@ericksarria07](https://github.com/ericksarria07)
