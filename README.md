# 🧵 EntreLazados

**EntreLazados** es un mercado en línea de **insumos y materia prima para artesanos del cuero y el calzado en Nicaragua**. Conecta a **proveedores** de cuero, herrajes, suelas, pegamentos y otros materiales con **emprendedores** que fabrican calzado y artículos de cuero.

Los proveedores publican sus materiales, y cada publicación abre una subasta. Los emprendedores comparan precios por cercanía, pujan y negocian por chat. **Kan**, el asistente virtual (con Google Gemini), orienta a los usuarios dentro de la plataforma.

> Sitio en producción: `http://57.156.69.249:3000` (VM de Azure)

---

## Funcionalidades

### Proveedor
- Publica materiales con título, precio, unidad y categoría. Cada publicación crea automáticamente una **subasta** con el mismo precio base.
- Elimina sus publicaciones (las subastas y pujas asociadas se borran juntas).
- Ve su actividad en el dashboard: ofertas, subastas y pujas recibidas.

### Emprendedor
- **Mercado** con filtros por categoría y radio de cercanía (km), y mapa interactivo.
- **Subastas**: puja por encima del precio actual. La validación es atómica: dos pujas simultáneas nunca dejan un precio menor.
- **Chat** directo con los proveedores.

### Administrador
- Métricas de la plataforma, lista de usuarios, suspender o reactivar cuentas, eliminar usuarios o publicaciones y crear categorías.

### Para todos
- **Dashboard** con 8 indicadores, gráficas (Chart.js), precios de referencia por categoría, subastas en curso y **exportación a Excel** (6 hojas).
- **Kan**, el asistente virtual con IA.
- **Recuperación de contraseña por correo**: enlace de un solo uso que vence en 1 hora.
- Diseño adaptado a celular.

---

## Tecnologías

| Parte | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript sin frameworks; Chart.js, ExcelJS, Leaflet, Tabler Icons |
| Backend | Node.js 22 + Express 5 |
| Base de datos | MySQL 8 (`mysql2`) |
| Seguridad | `bcrypt` (contraseñas), `jsonwebtoken` (sesiones), `dotenv` (claves) |
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
    │   ├── correo.js             # envío de correos (recuperar contraseña)
    │   ├── .env.example          # plantilla de variables de entorno
    │   ├── .env                  # claves reales (NO se sube a git)
    │   └── public/               # lo único que ve el navegador
    │       ├── preview.html      # portada pública (página de inicio)
    │       ├── login.html, unirse.html, restablecer.html
    │       ├── index.html        # inicio con sesión
    │       ├── mercado.html, chat.html, perfil.html
    │       ├── dashboard.html, admin.html
    │       ├── sesion.js         # agrega el token a cada petición /api
    │       ├── styles.css
    │       └── *.webp, logo.png  # imágenes
    ├── sql/
    │   ├── esquema_mysql.sql     # crea la base completa desde cero
    │   └── migracion_v7.sql      # actualiza una base existente
    └── pruebas/
        ├── LEEME.md              # cómo correr las pruebas
        ├── pruebas_api.js        # 89 pruebas de integración
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

Si ya tienes una base de una versión anterior, usa `sql/migracion_v7.sql` en lugar del esquema completo.

### 3. Configurar el `.env`

Copia la plantilla y llena los valores:

```bash
cp entrelazados-api/.env.example entrelazados-api/.env
```

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Sí | Conexión a MySQL |
| `JWT_SECRET` | Sí | Firma las sesiones. Genera una con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GEMINI_API_KEY` | No | Clave de Google AI Studio para Kan. Sin ella, Kan solo contesta sus preguntas frecuentes predefinidas |
| `EMAIL_USER`, `EMAIL_PASS` | No | Cuenta de Gmail y [contraseña de aplicación](https://myaccount.google.com/apppasswords) para enviar los correos de recuperación |
| `EMAIL_HOST`, `EMAIL_PORT` | No | Solo si usas otro servidor SMTP en lugar de Gmail |
| `APP_URL` | No | Dirección pública del sitio para los enlaces del correo |

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

Hay 89 pruebas de integración que recorren registro, login, ofertas, subastas, pujas, chat, perfil, panel de administrador y recuperación de contraseña. Usan una base MySQL **aparte** (`entrelazados_pruebas`) y nunca tocan la real.

Las instrucciones completas están en [`backend/pruebas/LEEME.md`](backend/pruebas/LEEME.md). Ahí también se explica cómo cargar datos de demostración para ver el dashboard con información.

---

## Seguridad

- **Contraseñas** cifradas con bcrypt. Las cuentas antiguas en texto plano se cifran solas al iniciar sesión.
- **Sesiones con JWT** (8 horas). En cada petición se consulta el rol y el estado actuales, así que una cuenta suspendida pierde el acceso al instante.
- Las rutas usan el usuario del token, **nunca un id enviado por el navegador**. Solo los proveedores publican y solo los emprendedores pujan.
- **Consultas SQL parametrizadas** contra inyección SQL, y **escape de HTML** contra XSS.
- Recuperación de contraseña: 1 solicitud por minuto por correo, la misma respuesta exista o no la cuenta, y enlace de un solo uso.
- Solo la carpeta `public/` es accesible desde el navegador.

---

## API

Todas las rutas responden JSON. 🔒 = requiere `Authorization: Bearer <token>` (lo agrega `sesion.js` automáticamente).

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/registro` | Crear cuenta (Proveedor o Emprendedor) |
| POST | `/api/login` | Iniciar sesión; devuelve el token |
| POST | `/api/solicitar-recuperacion` | Enviar el enlace para restablecer la contraseña |
| GET | `/api/validar-token-recuperacion` | Comprobar si un enlace sigue vigente |
| POST | `/api/restablecer-password` | Guardar la nueva contraseña |
| GET | `/api/ofertas`, `/api/subastas`, `/api/categorias`, `/api/estadisticas` | Datos públicos del mercado |
| POST | `/api/ofertas` 🔒 | Publicar material (proveedor) |
| DELETE | `/api/ofertas/:id` 🔒 | Eliminar una publicación propia |
| POST | `/api/pujas` 🔒 | Pujar en una subasta (emprendedor) |
| GET | `/api/chat/contactos`, `/api/chat/mensajes` 🔒 | Conversaciones propias |
| POST | `/api/chat/enviar` 🔒 | Enviar un mensaje |
| POST | `/api/chat/ia` | Preguntar a Kan |
| GET | `/api/perfil/:id` 🔒 | Perfil propio (o cualquiera si eres admin) |
| GET | `/api/dashboard` 🔒 | Datos del dashboard según el rol |
| GET/PUT/DELETE/POST | `/api/admin/...` 🔒 | Panel de administrador (solo admin) |

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

Si un cambio trae un archivo nuevo en `sql/`, aplícalo antes de reiniciar:

```bash
mysql -u entrelazados_app -p entrelazadosdb < backend/sql/<archivo>.sql
```

---

## Flujo de trabajo con git

- Se trabaja en la rama **`main`** y se pasa a **`master`** (rama principal) con un *pull request*.
- Antes de subir cambios, corre las pruebas (`backend/pruebas/LEEME.md`).

---

## Autor

**Erick Sarria** · [@ericksarria07](https://github.com/ericksarria07)
