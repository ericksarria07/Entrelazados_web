# 🧵 EntreLazados

**EntreLazados** es un mercado en línea de **insumos y materia prima para artesanos del cuero y el calzado en Nicaragua**. Conecta a **proveedores** de cuero, herrajes, suelas, pegamentos y otros materiales con **emprendedores** que fabrican calzado y artículos de cuero.

Los proveedores publican sus materiales, y cada publicación abre una subasta. Los emprendedores comparan precios por cercanía, pujan y negocian por chat. **Kan**, el asistente virtual (con Google Gemini), orienta a los usuarios dentro de la plataforma.

> Sitio en producción: `http://57.156.69.249:3000` (VM de Azure)

---

## Funcionalidades

### Proveedor
- Publica materiales con título, **descripción**, precio, unidad, categoría y **hasta 5 fotos**. Las fotos se reducen en el navegador antes de subirlas (una foto de celular de 5 MB queda en unos 400 KB).
- Cada publicación crea automáticamente una **subasta** de 7 días con el mismo precio base, que muestra sus fotos.
- **Crear subastas** desde el Mercado: de una de sus publicaciones o de un lote nuevo, de 3 a 14 días.
- **Edita** sus publicaciones (título, precio, unidad, categoría y fotos): si tienen una subasta abierta, esta toma el título y la categoría nuevos.
- Elimina sus publicaciones: si su subasta sigue abierta y sin pujas, se **cancela** con ella. Si ya tiene pujas, hay que esperar a que cierre (el administrador sí puede retirarla y se avisa por el chat a quienes pujaron).
- Las **categorías** de los formularios y del buscador salen de la base de datos: una categoría nueva del administrador aparece sola.
- Ve su actividad en el dashboard: ofertas, subastas, pujas recibidas y **subastas vendidas**.
- **Asistente de IA al publicar** (Gemini): a partir de una foto del material (o del título) propone el título, la descripción, la categoría y la unidad. **Sugerir precio** compara con las publicaciones parecidas de la misma categoría y unidad y con las subastas cerradas: Gemini propone un precio dentro de ese rango y explica por qué; si Gemini no responde, sugiere la mediana. La IA solo propone: nada se guarda hasta que el proveedor publica.

### Emprendedor
- **Mercado** con búsqueda, filtros por categoría y radio de cercanía (km), **páginas** de 10 ofertas y mapa interactivo. Cada oferta muestra al proveedor y su **calificación**.
- **Contactar Proveedor** abre directamente el chat con quien publicó.
- **Subastas**: puja por encima del precio actual. La validación es atómica: dos pujas simultáneas nunca dejan un precio menor.
- **Subastas ganadas** en el dashboard, con un botón para coordinar la entrega por chat (de a 5, con *Anterior / Siguiente*).
- **Favoritos**: guarda publicaciones con el corazón y las ve en la pestaña *Favoritos y Alertas*. Si una publicación guardada **baja de precio**, llega una notificación.
- **Alertas de búsqueda**: "avísame cuando publiquen *cuero café* en *Cuero vacuno* por menos de C$500" (palabra clave, categoría y precio máximo; hasta 10). Cuando alguien publica algo que cumple, llega a la campana y por correo. El botón **Avísame de nuevas** crea la alerta con lo que está escrito en el buscador.
- **Perfil público** (`perfil-publico.html?id=N`): el nombre de cada proveedor en el Mercado, en el mapa y en los tratos lleva a su página, con sus publicaciones, subastas activas, tratos completados, calificación (con cuántas de cada estrella) y reseñas. Se puede **compartir** y se ve sin iniciar sesión; nunca muestra correo, teléfono, dirección ni RUC. Desde *Mi perfil* cada uno ve el suyo.
- **Mapa de proveedores**: un círculo por departamento (crece con la cantidad de proveedores) con la lista de quién vende ahí, sus publicaciones y su calificación; respeta la categoría elegida en el buscador. *Ver publicaciones* filtra el Mercado por ese proveedor.

### Seguimiento de tratos
Cada subasta ganada es un trato que proveedor y comprador avanzan desde el dashboard:

`Pendiente` → `En proceso` (pago y entrega acordados) → `Completado`, o `Cancelado` (con motivo opcional) mientras no esté completado.

Cualquiera de los dos puede cambiarlo; la otra parte recibe un aviso automático en el chat y un correo. Los tratos cancelados no cuentan en "subastas ganadas / vendidas".

**Comprobante**: cada trato tiene un botón *Comprobante* (`comprobante.html?trato=ID`) con folio (`EL-000042`), los datos de las dos partes, el lote, el precio base, las pujas, el monto en número y en letras y el estado (si se cancela queda "ANULADO"). Se guarda como **PDF** con la impresión del navegador. Aclara que no es una factura fiscal.

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

### Tiempo real
Las páginas abiertas reciben los cambios al instante (Socket.IO), sin recargar:
- en el **Mercado**, el precio y el número de pujas de cada subasta cambian solos cuando alguien puja (indicador "En vivo"), y la lista se actualiza cuando se crea, cancela o cierra una subasta;
- en el **Chat**, los mensajes nuevos aparecen enseguida (antes la página preguntaba cada 2 segundos; ahora eso queda solo de respaldo);
- el contador de mensajes sin leer del menú se actualiza al llegar cada mensaje.

### Notificaciones
Una **campana** en el menú de todas las páginas, con el número sin leer. Avisa cuando:
- **te superan en una puja** (también por correo),
- tu subasta recibe una puja nueva,
- **ganas** una subasta, o termina o se cancela una en la que pujaste,
- termina tu subasta (con o sin ganador),
- la otra parte cambia el estado de un trato o te **califica**,
- se publica algo que cumple una de tus **alertas de búsqueda** (también por correo),
- una publicación que guardaste en **favoritos baja de precio**.

Las nuevas aparecen al instante con un aviso flotante. Si ya tienes un aviso sin leer de la misma subasta, se actualiza en vez de repetirse (una "guerra de pujas" no llena la campana). Al hacer clic se marca como leída y lleva a la página correspondiente.

### Reportes
Página **Reportes** (`reportes.html`) con gráficas y tablas del periodo elegido (3, 6 o 12 meses):
- el **proveedor** ve sus ventas, el **emprendedor** sus compras y el **administrador** toda la plataforma;
- ventas por mes, resultado de las subastas (con ganador, sin pujas, canceladas, en curso), **materiales más pedidos**, **precio promedio por categoría** mes a mes, lotes más disputados y el detalle de los tratos;
- se exporta a **Excel** (6 hojas) y a **PDF** (con la opción "Guardar como PDF" del navegador; funciona también en el celular).

### Para todos
- **Dashboard** con 8 indicadores, gráficas (Chart.js), precios de referencia por categoría, subastas en curso y **exportación a Excel** (6 hojas).
- **Kan**, el asistente virtual con IA. La conversación sigue al cambiar de página (se guarda en el navegador hasta cerrar sesión o que venza la sesión) y Kan recuerda los últimos 10 mensajes al contestar.
- **Chat** directo entre proveedores y emprendedores, con **contador de mensajes no leídos** en el menú de todas las páginas y en cada contacto, y la marca "Visto".
- **Confirmación del correo al registrarse**: enlace de 24 horas; sin confirmarlo no se puede entrar (se puede pedir otro enlace desde el login).
- **Recuperación de contraseña por correo**: enlace de un solo uso que vence en 1 hora.
- Diseño adaptado a celular.
- **Modo oscuro**: la primera vez sigue el modo del sistema; el botón redondo de abajo a la izquierda lo cambia y la elección se recuerda en el navegador (también al cerrar sesión). Al imprimir o guardar un PDF siempre se usa el modo claro.
- **Accesibilidad**: foco visible al navegar con el teclado, enlace "Saltar al contenido", etiquetas en los campos y en los botones que solo tienen un ícono, ventanas con `role="dialog"`, pestañas con `role="tab"`, imágenes con texto alternativo y menos animaciones si el sistema lo pide.

---

## Tecnologías

| Parte | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript sin frameworks; Chart.js, ExcelJS, Leaflet, Tabler Icons |
| Backend | Node.js 22 + Express 5 |
| Tiempo real | Socket.IO (en el mismo servidor y puerto) |
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
├── ROADMAP.md                    # plan de migración a Next.js + Vercel + Neon
├── .github/workflows/
│   └── pruebas.yml               # GitHub Actions: corre todas las pruebas en cada push y PR
├── web/                          # app en Next.js (migración en curso, ver la sección Next.js)
│   ├── next.config.ts            # "/" muestra preview.html, igual que Express
│   ├── app/api/salud/route.ts    # GET /api/salud: la app y Neon contestan
│   ├── lib/db.ts                 # db (Drizzle) y el Pool de pg hacia Neon (attachDatabasePool)
│   ├── db/esquema.ts             # las 18 tablas en Drizzle: fuente única del esquema
│   ├── db/migraciones/           # SQL generado por drizzle-kit (+ 0001_extras.sql escrito a mano)
│   ├── drizzle.config.ts         # drizzle-kit: conexión directa de Neon, snake_case
│   ├── scripts/probar-neon.ts    # npm run probar:neon (prueba de punta a punta de Neon)
│   ├── pruebas/api/              # pruebas de integración de la API (npm run test:api), una sección por archivo
│   ├── neon.ts                   # configuración de Neon (neon env pull escribe web/.env.local)
│   └── public/                   # copia de las páginas de Express; se pasan a React una por una
└── backend/
    ├── package.json              # dependencias y comandos: npm install, npm start, npm test
    ├── entrelazados-api/
    │   ├── index.js              # arranque: crea la base de datos, los servicios y la app, y escucha
    │   ├── app.js                # Express: middlewares, rutas, archivos estáticos y errores
    │   ├── config.js             # variables del .env, revisadas una sola vez
    │   ├── db.js                 # conexión a MySQL (async/await) y enTransaccion()
    │   ├── utilidades.js         # ErrorHttp, paginación, validaciones
    │   ├── middlewares/
    │   │   ├── autenticacion.js  # verificarToken, soloRoles, verificarAdmin (JWT)
    │   │   ├── limites.js        # límites de intentos (login, registro, Kan...)
    │   │   └── errores.js        # 404 de la API y manejador central de errores
    │   ├── docs/
    │   │   └── openapi.yaml      # especificación OpenAPI de las 54 rutas (se ve en /api/docs)
    │   ├── rutas/                # una por tema, cada una con sus URLs al principio
    │   │   ├── cuentas.js        # registro, login, recuperación y confirmación del correo
    │   │   ├── ofertas.js, subastas.js, chat.js, kan.js, tratos.js
    │   │   ├── usuarios.js       # perfil y reputación
    │   │   ├── publicas.js       # ping, categorías, estadísticas
    │   │   ├── dashboard.js
    │   │   ├── reportes.js       # ventas, compras y mercado (GET /api/reportes)
    │   │   ├── notificaciones.js # la campana: ver y marcar como leídas
    │   │   ├── favoritos.js      # favoritos y alertas de búsqueda
    │   │   ├── mapa.js           # proveedores por departamento (mapa del Mercado)
    │   │   ├── ia.js             # asistente de IA para publicar (descripción y precio)
    │   │   ├── admin.js          # panel de administrador
    │   │   └── documentacion.js  # Swagger UI en /api/docs
    │   ├── servicios/            # lógica que no depende de HTTP
    │   │   ├── correo.js         # envío de correos (recuperación, confirmación y avisos)
    │   │   ├── fotos.js          # recibir, validar, guardar y borrar fotos
    │   │   ├── ofertas.js        # validar, borrar publicaciones y crear su subasta
    │   │   ├── subastas.js       # cierre automático de subastas vencidas
    │   │   ├── tratos.js         # estados de los tratos y calificaciones
    │   │   ├── notificaciones.js # guardar avisos, empujarlos en tiempo real y por correo
    │   │   ├── tiempoReal.js     # Socket.IO: quién está conectado y a quién avisar
    │   │   ├── favoritos.js      # favoritos, alertas y sus avisos (nueva publicación, rebaja)
    │   │   ├── departamentos.js  # los 17 departamentos de Nicaragua con sus coordenadas
    │   │   ├── asistenteIA.js    # Gemini: describir una publicación y sugerir su precio
    │   │   └── kan.js            # respuestas fijas de Kan + Gemini
    │   ├── uploads/              # fotos subidas (NO se sube a git; va en los respaldos)
    │   ├── .env.example          # plantilla de variables de entorno
    │   ├── .env                  # claves reales (NO se sube a git)
    │   └── public/               # lo único que ve el navegador
    │       ├── preview.html      # portada pública (página de inicio)
    │       ├── login.html, unirse.html, restablecer.html, verificar.html
    │       ├── index.html        # inicio con sesión
    │       ├── mercado.html      # el Mercado: solo el HTML; sus estilos y su código están en:
    │       ├── mercado.css       #   estilos del Mercado (también los usa el perfil público)
    │       ├── mercado.js        #   núcleo: inicio, ofertas, subastas y pujas, pestañas, tiempo real
    │       ├── mercado-publicar.js  # fotos, publicar/editar, crear subasta y asistente de IA
    │       ├── mercado-favoritos.js # favoritos (paginados) y alertas de búsqueda
    │       ├── mercado-mapa.js   #   mapa de proveedores (Leaflet)
    │       ├── perfil-publico.html  # perfil que se comparte (?id=N), se ve sin sesión
    │       ├── chat.html, perfil.html
    │       ├── dashboard.html, reportes.html, admin.html
    │       ├── comprobante.html  # comprobante de un trato, para imprimir o guardar como PDF
    │       ├── tema.js, tema.css # modo oscuro y accesibilidad (todas las páginas)
    │       ├── panel.css         # estilos del dashboard y de los reportes
    │       ├── sesion.js         # token en cada /api, tiempo real, mensajes no leídos, esc(), cerrarSesion()
    │       ├── notificaciones.js # la campana del menú (se carga sola en las páginas con sesión)
    │       ├── kan.js, kan.css   # el asistente Kan (un solo componente para todas las páginas)
    │       ├── comun.css         # estilos que comparten las páginas internas (cabecera, menú)
    │       ├── categorias.js     # llena los <select> de categorías desde la API
    │       └── *.webp, logo.png  # imágenes
    ├── sql/
    │   ├── esquema_mysql.sql     # crea la base completa desde cero
    │   ├── migracion_v7.sql      # rol Administrador
    │   ├── migracion_v8.sql      # fotos en disco y cierre de subastas
    │   ├── migracion_v9.sql      # subastas ligadas a su publicación, estado Cancelada
    │   ├── migracion_v10.sql     # confirmar correo, calificaciones, mensajes no leídos
    │   ├── migracion_v12.sql     # notificaciones
    │   └── migracion_v13.sql     # favoritos, alertas de búsqueda y descripción de las publicaciones
    ├── scripts/
    │   ├── LEEME.md              # respaldos, correo y clave de Gemini en la VM
    │   ├── respaldo.sh           # respaldo de MySQL + fotos (rota a los 7 días)
    │   ├── restaurar.sh          # restaurar un respaldo
    │   ├── instalar_cron.sh      # programa el respaldo diario
    │   ├── configurar_correo.sh  # guarda EMAIL_USER / EMAIL_PASS / APP_URL y manda una prueba
    │   └── probar_gemini.js      # comprueba la clave de Gemini (Kan)
    └── pruebas/
        ├── LEEME.md              # cómo correr las pruebas
        ├── unidad/               # 78 pruebas unitarias (node:test, sin base de datos)
        ├── correr_pruebas.js     # npm run test:api: prepara la base de pruebas, levanta el servidor y corre todo
        ├── pruebas_api.js        # 402 pruebas de integración (incluye tiempo real con Socket.IO)
        ├── cargar_esquema.js
        └── datos_demo.js         # datos de ejemplo para el dashboard
```

### Cómo viaja una petición

Ejemplo: un emprendedor puja en una subasta (`POST /api/pujas`).

```
navegador ──► app.js ──► middlewares ──────────────► rutas/subastas.js ──► db.js ──► MySQL
              (JSON,     limites.api                  valida los datos,
               límites)  verificarToken (¿quién es?)   UPDATE + INSERT en
                         soloRoles('emprendedor')      una transacción
                                                            │
              middlewares/errores.js ◄── si algo falla ─────┘  (ErrorHttp → 4xx con su mensaje;
                                                                cualquier otro → 500 genérico)
```

- **Rutas** (`rutas/`): leen la petición, validan y responden. No saben de SMTP ni de archivos.
- **Servicios** (`servicios/`): la lógica que usan varias rutas o el cierre automático (correo, fotos, tratos, Kan...).
- **Dependencias inyectadas**: `index.js` crea la base de datos y los servicios y se los pasa a cada ruta al crearla; ninguna ruta usa variables globales. Así cada pieza se puede probar o cambiar por separado.
- **Errores centralizados**: las rutas lanzan `new ErrorHttp(404, 'mensaje')` y un único manejador responde. Express 5 atrapa solo los errores de las funciones `async`.
- **Transacciones** con `enTransaccion(db, async (conn) => { ... })`: o se guarda todo, o nada.

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

Si ya tienes una base de una versión anterior, en lugar del esquema completo aplica las migraciones que te falten, en orden: `sql/migracion_v7.sql`, `sql/migracion_v8.sql`, `sql/migracion_v9.sql`, `sql/migracion_v10.sql`, `sql/migracion_v12.sql` y `sql/migracion_v13.sql` (no hay v11).

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

Desde `backend/`:

```bash
npm start
```

Abre http://localhost:3000.

Para crear el primer administrador, registra una cuenta normal y cambia su rol en MySQL:

```sql
UPDATE Usuarios SET TipoRol = 'Administrador' WHERE CorreoElectronico = 'tu_correo@ejemplo.com';
```

Para comprobar el envío de correos sin usar la página:

```bash
npm run probar:correo -- tu_correo@gmail.com
npm run probar:gemini          # comprueba la clave de Gemini (Kan)
```

---

## Pruebas

[![Pruebas](https://github.com/ericksarria07/Entrelazados_web/actions/workflows/pruebas.yml/badge.svg)](https://github.com/ericksarria07/Entrelazados_web/actions/workflows/pruebas.yml)

Hay dos tipos de pruebas:

| | Cuántas | Qué necesitan | Comando (desde `backend/`) |
|---|---|---|---|
| **Unitarias** (`pruebas/unidad/`) | 78 | Nada: ni MySQL ni `.env`. Tardan ~1 s | `npm run test:unidad` |
| **De integración** (`pruebas/pruebas_api.js`) | 402 | La base MySQL de pruebas | `CLAVE_PRUEBAS=... npm run test:api` |

`npm test` corre las dos, una detrás de otra. `npm run test:cobertura` muestra qué porcentaje del código recorren las unitarias.

Las **unitarias** usan el corredor de pruebas que trae Node (`node:test`) y prueban piezas sueltas, cambiando la base de datos por un objeto falso:
- validaciones y utilidades (correos, paginación, publicaciones, comodines de búsqueda)
- la máquina de estados de los tratos y las respuestas fijas de Kan
- sesión y permisos: tokens falsos, vencidos o de cuentas suspendidas
- el manejador de errores, que no revela detalles de un error inesperado
- la aplicación Express completa sin MySQL: 404, 401, JSON mal escrito y que el `.env` no se pueda descargar
- que **cada ruta del código esté documentada** en `openapi.yaml` (y que no sobre ninguna)
- las notificaciones (agrupar avisos, correo una sola vez) y un servidor **Socket.IO** de verdad: quién puede conectarse y a quién le llega cada evento
- las alertas de búsqueda (sin importar tildes ni mayúsculas), los departamentos del mapa y los cálculos del asistente de precios

Las **de integración** recorren registro y confirmación del correo, login, ofertas (publicar, editar, paginar y filtrar), fotos, subastas (crear, cancelar y cerrar, con aviso a quienes pujaron), pujas, seguimiento y calificación de tratos, chat y mensajes no leídos, perfil, panel de administrador (incluida la corrección de correos), recuperación de contraseña, favoritos y alertas (a quién le llega cada aviso), comprobantes, el mapa de proveedores, el asistente de IA (con y sin Gemini), el perfil público (qué datos muestra y a quién no), la paginación de favoritos, tratos y reseñas, y límites de intentos. Usan una base MySQL **aparte** (`entrelazados_pruebas`) y nunca tocan la real.

Una vez creada la base de pruebas (paso 1 de [`backend/pruebas/LEEME.md`](backend/pruebas/LEEME.md)), se corren todas con un solo comando desde `backend/`:

```bash
CLAVE_PRUEBAS=la_clave_de_la_base_de_pruebas npm test
```

### En GitHub (integración continua)

En cada `push` y en cada *pull request* a `main` o `master`, **GitHub Actions** ([`.github/workflows/pruebas.yml`](.github/workflows/pruebas.yml)) corre las unitarias con Node 20 y 22, y las 402 de integración contra un MySQL 8.0 nuevo en Linux (igual que la VM). El resultado aparece como ✅ o ❌ junto a cada commit, en la pestaña **Actions** y en el *pull request*: si algo falla, no conviene mezclarlo a `master`.

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

📖 **Documentación interactiva:** abre **`/api/docs`** en el servidor (por ejemplo http://localhost:3000/api/docs). Es Swagger UI: muestra cada ruta con sus datos de entrada, sus respuestas y sus errores, y permite **probarla desde el navegador** (inicia sesión con `POST /api/login`, copia el `token` y pégalo en el botón *Authorize*). La especificación está en [`backend/entrelazados-api/docs/openapi.yaml`](backend/entrelazados-api/docs/openapi.yaml) y en crudo en `/api/openapi.json` (se puede importar en Postman o Insomnia).

Resumen. Todas las rutas responden JSON. 🔒 = requiere `Authorization: Bearer <token>` (lo agrega `sesion.js` automáticamente).

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/registro` | Crear cuenta (Proveedor o Emprendedor). Si hay que confirmar el correo responde `verificacionPendiente: true` |
| GET | `/api/verificar-correo?token=` | Confirmar el correo con el enlace recibido |
| POST | `/api/reenviar-verificacion` | Pedir otro enlace de confirmación `{ email }` |
| POST | `/api/login` | Iniciar sesión; devuelve el token |
| POST | `/api/solicitar-recuperacion` | Enviar el enlace para restablecer la contraseña |
| GET | `/api/validar-token-recuperacion` | Comprobar si un enlace sigue vigente |
| POST | `/api/restablecer-password` | Guardar la nueva contraseña |
| GET | `/api/ofertas`, `/api/subastas`, `/api/categorias`, `/api/estadisticas` | Datos públicos del mercado. Filtros `q`, `categoria` (en ofertas también `maxKm`, `proveedorId`, `id`, y en subastas `proveedorId`; `q` también busca en la descripción). Con `?pagina=N&porPagina=M` responden `{ datos, total, pagina, porPagina, paginas }` |
| POST | `/api/ofertas` 🔒 | Publicar material (proveedor). JSON, o `multipart/form-data` con hasta 5 archivos en `fotos` |
| PUT | `/api/ofertas/:id` 🔒 | Editar una publicación propia (o cualquiera si eres admin). Mismos campos que al publicar, más `fotosQuitar` y fotos nuevas |
| DELETE | `/api/ofertas/:id` 🔒 | Eliminar una publicación propia (cancela su subasta abierta; 409 si ya tiene pujas) |
| POST | `/api/subastas` 🔒 | Crear una subasta: `{ precioBase, dias, ofertaId }` o `{ tituloLote, precioBase, categoriaId, dias }` (proveedor) |
| POST | `/api/pujas` 🔒 | Pujar en una subasta (emprendedor) |
| GET | `/api/chat/contactos`, `/api/chat/mensajes` 🔒 | Conversaciones propias (primero las que tienen mensajes sin leer). Abrir una conversación marca sus mensajes como leídos |
| GET | `/api/chat/no-leidos` 🔒 | `{ total, porContacto }` mensajes sin leer |
| POST | `/api/chat/enviar` 🔒 | Enviar un mensaje |
| POST | `/api/chat/ia` 🔒 | Preguntar a Kan (`mensajeUsuario` y, opcional, `historial` con los últimos mensajes) |
| GET | `/api/tratos` 🔒 | Mis subastas ganadas o vendidas (primero las abiertas). `?origen=Subasta`, `?pagina=&porPagina=` |
| PUT | `/api/tratos/:id/estado` 🔒 | `{ estado: 'EnProceso' \| 'Completado' \| 'Cancelado', motivo? }` (solo las dos partes del trato) |
| POST | `/api/tratos/:id/calificacion` 🔒 | `{ puntuacion: 1-5, comentario? }` una vez por persona, solo tratos completados |
| GET | `/api/tratos/:id/comprobante` 🔒 | Datos del comprobante (las dos partes del trato o el admin) |
| GET/POST/DELETE | `/api/favoritos`, `/api/favoritos/ids`, `/api/favoritos/:ofertaId` 🔒 | Publicaciones guardadas (`?pagina=&porPagina=`) |
| GET/POST/DELETE | `/api/alertas`, `/api/alertas/:id` 🔒 | Alertas de búsqueda `{ palabraClave?, categoriaId?, precioMaximo? }` (máximo 10) |
| GET | `/api/mapa/proveedores?categoria=` 🔒 | Proveedores agrupados por departamento, con coordenadas |
| POST | `/api/ia/publicacion` 🔒 | Proponer título, descripción, categoría y unidad desde una foto (`multipart`, campo `fotos`) y/o `titulo` (proveedor; 503 si Gemini no está disponible) |
| POST | `/api/ia/precio` 🔒 | Sugerir un precio `{ titulo?, categoriaId, unidad?, ofertaId? }` (proveedor) |
| GET | `/api/usuarios/:id/reputacion` 🔒 | Promedio, total y últimas calificaciones recibidas |
| GET | `/api/usuarios/:id/publico` | Perfil público de un proveedor o emprendedor activo, sin datos de contacto (sin sesión; 404 para admin o cuentas suspendidas) |
| GET | `/api/usuarios/:id/resenas?pagina=` | Reseñas recibidas, de a 5 (sin sesión) |
| GET | `/api/perfil/:id` 🔒 | Perfil propio (o cualquiera si eres admin) |
| GET | `/api/dashboard` 🔒 | Datos del dashboard según el rol |
| GET | `/api/reportes?meses=3\|6\|12` 🔒 | Reporte de ventas (proveedor), compras (emprendedor) o de la plataforma (admin) |
| GET | `/api/notificaciones` 🔒 | Las 30 notificaciones más recientes y cuántas faltan por leer |
| PUT | `/api/notificaciones/:id/leida`, `/api/notificaciones/leidas` 🔒 | Marcar una o todas como leídas |
| GET/PUT/DELETE/POST | `/api/admin/...` 🔒 | Panel de administrador (solo admin). `GET /api/admin/usuarios?pagina=&buscar=&problemas=1` |
| PUT | `/api/admin/usuarios/:id/correo` 🔒 | Corregir el correo de una cuenta `{ correo }` (solo admin) |
| PUT | `/api/admin/usuarios/:id/verificar` 🔒 | Dar por confirmado el correo de una cuenta (solo admin) |
| POST | `/api/admin/subastas/cerrar-vencidas` 🔒 | Cerrar ya las subastas vencidas, sin esperar al minuto (solo admin) |

---

## Neon (Postgres) con Drizzle: migración en curso

La app de Express **sigue usando MySQL**. La nueva (`web/`) usa Neon, y su esquema vive en código con **Drizzle**.

| | |
|---|---|
| Proyecto | Neon `Entrelazados`, rama `production` (vinculada en `web/.neon`, ignorado por git) |
| Variables | `DATABASE_URL` (con pooler, para la app) y `DATABASE_URL_UNPOOLED` (directa, para migraciones), en `web/.env.local` (ignorado por git) |
| Esquema | `web/db/esquema.ts`: camelCase en TypeScript, snake_case en la base (`casing: 'snake_case'`) |
| Migraciones | `web/db/migraciones/`: `0000_inicial.sql` (generada) y `0001_extras.sql` (a mano: `unaccent`, trigger de `fecha_actualizacion` y las 15 categorías) |
| Driver | `pg` (node-postgres) + `drizzle-orm/node-postgres` |

Desde `web/`:

```bash
neon login && neon env pull   # (una vez) escribe DATABASE_URL y DATABASE_URL_UNPOOLED en .env.local
npm run db:migrar             # aplica en Neon las migraciones que falten
npm run probar:neon           # prueba de punta a punta por la conexión con pooler
npm run db:estudio            # Drizzle Studio: ver y editar los datos en el navegador
```

**Cambiar el esquema:**
1. Edita `db/esquema.ts`.
2. `npm run db:generar` crea el SQL en `db/migraciones/`. Revísalo y súbelo junto con el cambio.
3. Al mezclar el PR, el build de Vercel la aplica sola (ver "Despliegue continuo"). `npm run db:migrar` sigue sirviendo para aplicarla a mano.

**Las migraciones tienen que ser compatibles hacia atrás**: primero se agrega (columna nueva con valor por defecto o que acepte NULL) y en otro PR, cuando ya nada la usa, se quita lo viejo. Así un rollback a la versión anterior sigue funcionando con el esquema nuevo.

Lo que Drizzle no sabe expresar (funciones, triggers, datos) va en una migración a mano: `npx drizzle-kit generate --custom --name <nombre>`.
El CI corre `npm run db:revisar` para comprobar que las migraciones sean coherentes.

`probar:neon` comprueba:
- la conexión y las 18 tablas;
- `INSERT ... RETURNING`;
- dos pujas simultáneas con `SELECT ... FOR UPDATE`: la segunda espera y se rechaza si ya no supera el precio;
- la búsqueda sin acentos (`unaccent` + `ILIKE`);
- que `COUNT(*)` llega como texto;
- el trigger de `fecha_actualizacion`.

Al final borra sus datos de prueba.

Diferencias con MySQL que tendrán en cuenta las consultas migradas: nombres en snake_case, `timestamptz`,
`boolean`, `RETURNING` en lugar de `insertId`, y `numeric` y `COUNT(*)` llegan como texto.

---

## Next.js en Vercel (`web/`): migración en curso

La carpeta `web/` es la app en **Next.js 16** que reemplazará a Express (ver [ROADMAP](ROADMAP.md)).
Vive en la rama `migracion-nextjs`. Por ahora sirve las mismas páginas de siempre, copiadas tal cual a `web/public/`.
Las rutas de la API se van pasando a Next.js en las ramas `nextjs/<tema>`. Ya funcionan registro, login, confirmación del correo, recuperación de contraseña, ofertas (con fotos), subastas, pujas, cierre de subastas, tratos, dashboard, chat, campana de notificaciones, tiempo real (Ably), favoritos, alertas de búsqueda, mapa de proveedores, Kan, asistente de IA para publicar, reportes, panel de admin, categorías, estadísticas y perfiles: **toda la API de Express** (las 32 secciones de pruebas activas). Documentación interactiva en `/api/docs` (especificación en `web/docs/openapi.yaml`; la sección 12 avisa si una ruta de `app/api/` no está documentada).

| | |
|---|---|
| Sitio | https://entrelazados.ericksv.com (CNAME en Cloudflare con nube gris, hacia Vercel) |
| Vercel | proyecto `entrelazados`, *Root Directory* `web`, Node 22, rama de producción `migracion-nextjs` |
| Variables | `DATABASE_URL` (Neon con pooler) y `JWT_SECRET` en Vercel. Opcionales: `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_HOST`, `EMAIL_PORT`, `APP_URL`, `VERIFICAR_CORREO` y `LIMITE_*`, con el mismo significado que en Express. Sin correo configurado, las cuentas se crean ya confirmadas. `BLOB_READ_WRITE_TOKEN` (production y preview) la agregó el Blob store `entrelazados-fotos`: con ella las fotos van a Vercel Blob; sin ella, a disco (`UPLOADS_DIR`, por defecto una carpeta temporal) servidas en `/uploads/ofertas/`. `CRON_SECRET` protege el cron diario (`web/vercel.json`) y `APP_URL` = `https://entrelazados.ericksv.com` arma los enlaces de los correos (las dos solo en production). `CIERRE_PEREZOSO=0` apaga el cierre perezoso. `ABLY_API_KEY` (production y preview; la llave de pruebas va en `web/.env.local`) enciende el tiempo real; los canales se separan por `ABLY_CANAL_PREFIJO` (por defecto `VERCEL_ENV`). `GEMINI_API_KEY` (production, *Sensitive*; clave gratis de [Google AI Studio](https://aistudio.google.com/apikey), se carga con `vercel env add GEMINI_API_KEY production --sensitive`) enciende la IA: sin ella Kan da sus respuestas fijas, la descripción con IA responde 503 y la sugerencia de precio usa la mediana. `GEMINI_MODELO` = `gemini-3.5-flash-lite` en producción: en el plan gratis los modelos flash grandes (3.6–3.8) respondían 503/504 por alta demanda, y flash-lite contesta en 1–4 s, también con fotos y JSON. Cada llamada a Gemini tiene 20 s como máximo y un solo reintento (`web/lib/gemini.ts`), así que si Gemini falla se usa el respaldo en segundos |
| Código | Rutas en `web/app/**/route.ts`, con SQL a mano (`pg`). Ayudas en `web/lib/`: `http.ts` (`ruta()`, `ErrorHttp`), `sesion.ts` (`exigirSesion`, `exigirAdmin`), `limites.ts` (en memoria), `correo.ts` (nodemailer + `after()`) |
| Salud | `GET /api/salud` → `{"estado":"ok","bd":"ok"}` (503 si Neon no contesta) |

Correrla en tu máquina:

```bash
cd web
npm install
neon env pull                          # escribe .env.local (ver la sección Neon)
npm run dev                            # http://localhost:3000 y http://localhost:3000/api/salud
```

Cada *pull request* hacia `migracion-nextjs` recibe una vista previa en Vercel. Al mezclarlo, se publica en el dominio.
El CI corre `npm run lint` y `npm run build` de `web/` (check "Next.js (build)").

### Despliegue continuo

```
PR ──▶ CI (5 checks obligatorios) ──▶ vista previa en Vercel, con su propia rama de Neon (copia de producción)
                                        └─ migraciones en esa rama · humo: /api/salud
mezcla en migracion-nextjs ──▶ build de Vercel: migraciones en producción ──▶ next build
                                 (si fallan, el build falla y sigue la versión anterior)
                           ──▶ entrelazados.ericksv.com ──▶ humo: /api/salud, portada, /api/docs
```

| Pieza | Cómo |
|---|---|
| Rama protegida | `migracion-nextjs` exige los 5 checks del CI y no admite push directo (también para administradores) |
| Base de las vistas previas | Integración **Neon ↔ Vercel** instalada desde Neon (proyecto `Entrelazados`, rama `production`, base `neondb`, rol `neondb_owner`). En producción pone `DATABASE_URL`/`DATABASE_URL_UNPOOLED` de la rama `production`; en cada vista previa crea una rama de Neon copiada de `production` y pone sus variables solo para esa rama de git. Las ramas viejas se borran solas. Ojo: una vista previa tiene una copia de los datos reales (por eso las vistas previas están protegidas por Vercel). Las vistas previas no tienen `BLOB_READ_WRITE_TOKEN` (las fotos van a disco temporal) |
| Migraciones | `vercel.json` → `npm run vercel-build` = `scripts/migrar-en-build.mjs` (`drizzle-kit migrate` con `DATABASE_URL_UNPOOLED`) y `next build`. En producción, sin esa variable el build falla a propósito; en una vista previa sin base solo avisa |
| Prueba de humo | `.github/workflows/humo.yml`, con cada despliegue que Vercel reporta a GitHub. Producción: `/api/salud` (app y base, 3 intentos), `/`, `/api/docs` y `/api/ping`. Si falla, el workflow queda en rojo y GitHub avisa por correo. Vistas previas: solo `/api/salud`, y como están protegidas por Vercel necesitan el secreto `VERCEL_BYPASS` ("Protection Bypass for Automation"); sin él, solo avisa. Se puede correr a mano (Actions → Prueba de humo) contra cualquier URL |

**Rollback** (si producción falla): vuelve a la versión anterior al instante, sin reconstruir:

```bash
cd web
vercel rollback                  # o en Vercel: Deployments → el anterior → ⋯ → Instant Rollback
vercel promote <url-del-nuevo>   # cuando esté corregido, vuelve a la versión nueva
```

Después de un rollback, Vercel deja de publicar solo las mezclas nuevas hasta que se haga `promote`. El rollback no deshace migraciones: por eso tienen que ser compatibles hacia atrás.

---

## Administrador y recorrido completo (`web/`)

**Crear la cuenta de administrador** (registrarse como admin está prohibido a propósito):

```bash
cd web
npm run admin:crear     # pide correo, nombre y contraseña (no se muestra); usa DATABASE_URL de .env.local
```

Si el correo ya existe, ofrece convertir esa cuenta en administrador.

**Recorrido con capturas** (`web/pruebas/recorrido/recorrido.mjs`): Playwright abre el sitio en tamaño de teléfono y lo recorre como una persona: registro, publicar con fotos, editar, búsqueda, mapa, favoritos y alertas, pujas en vivo (Ably), campana, chat en vivo, cierre de la subasta, trato, calificación, comprobante, perfil público, dashboard, reportes (Excel y PDF), Kan, panel de admin (suspender, categorías), recuperar contraseña y Swagger.

```bash
cd web
npm run recorrido                                  # contra https://entrelazados.ericksv.com
RECORRIDO_URL=http://localhost:3000 npm run recorrido
```

| | |
|---|---|
| Cuentas | Temporales (`rec<fecha>-…@example.com`): un proveedor, dos emprendedores y un admin. Los correos se confirman en la base (a example.com no llegan los enlaces) |
| Limpieza | Al final, pase lo que pase, el admin temporal borra las cuentas por la API (con sus fotos de Blob y sus datos) y se borra a sí mismo |
| Resultado | Capturas `.jpg` y `resultado.json` en `web/pruebas/recorrido/salida/` (fuera de git) |
| Requisitos | `DATABASE_URL` de la misma base que la URL probada. Playwright fijo en 1.57.0: es la última versión con Chromium para macOS 13 |
| Ojo | Cuenta para el límite de 5 registros por hora por conexión: si se corre varias veces seguidas, los registros por formulario se anotan como "límite alcanzado" y las cuentas se crean en la base |

## Pruebas de la API en Next.js

Las ~400 comprobaciones de integración de Express (`backend/pruebas/pruebas_api.js`) se portaron a
`web/pruebas/api/`, para validar Next.js + Postgres a medida que se migran las rutas.

| Archivo | Qué hace |
|---|---|
| `correr.mjs` | Vacía la base de pruebas, aplica las migraciones de Drizzle, siembra, levanta `next start` en el puerto 3055 y corre las secciones activas |
| `secciones.mjs` | Las 32 secciones en orden, cada una con `activa` y lo que `requiere` |
| `secciones/NN-*.mjs` | Una sección por archivo. Comparten estado en `ctx` (sesiones, IDs) |
| `contexto.mjs` | `api()`, `check()`, `seccion()` y `q()` (consulta directa a la base de pruebas) |
| `semilla.mjs` | Departamentos, `admin@prueba.com` y `antiguo@prueba.com` (contraseña en texto plano) |

**Correrlas** (desde `web/`):

```bash
npm run build && npm run test:api
PRUEBAS_SECCIONES=01,02 npm run test:api   # corre esas secciones aunque no estén activas
```

| Dónde | Base de pruebas |
|---|---|
| Tu máquina | Rama `pruebas` de Neon (sin vencimiento). Sus URLs van en `web/.env.local` como `PRUEBAS_DATABASE_URL` y `PRUEBAS_DATABASE_URL_UNPOOLED` |
| GitHub Actions | Contenedor `postgres:18` desechable (job "API en Next.js (Postgres)") |

El corredor **vacía** la base de pruebas en cada corrida. Por eso se niega a correr si `PRUEBAS_DATABASE_URL` es la misma base que `DATABASE_URL`.

**Activar una sección:** en la rama que porta sus rutas, cambia `activa: false` por `activa: true` en `secciones.mjs`.
El CI solo corre las activas, así que siempre está en verde, y el resumen muestra el avance (`secciones activas 5/32`).
Conviene activarlas en orden, porque cada sección usa datos que crearon las anteriores.

**El contrato:** las comprobaciones sobre el JSON de la API no se cambian al portar. Las páginas HTML esperan
los mismos nombres (`OfertaID`, `TituloMaterial`…), así que la ruta nueva debe devolverlos igual.
Lo único que se tradujo fue el SQL de `q()`. `q()` devuelve las filas con los nombres de MySQL y los booleanos como `1/0`, igual que `mysql2`.

Estas secciones se reescriben cuando cambie su tecnología:

| Sección | Se reescribe en |
|---|---|
| 15 Cierre automático de subastas | En Vercel: cierre perezoso + cron diario. En las pruebas `CIERRE_PEREZOSO=0` y se cierra con la ruta del admin |
| 23 Tiempo real | Reescrita para Ably. Sin `ABLY_API_KEY` (como en el CI) las comprobaciones de entrega se omiten (⏭️) y se revisa que el permiso responda 503 |
| 32 Límites de intentos | Se activa cuando estén Kan y su límite (en memoria, `web/lib/limites.ts`) |

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

Los pasos exactos para pasar a cada versión están en [`backend/scripts/LEEME.md`](backend/scripts/LEEME.md).

### Respaldos

`backend/scripts/respaldo.sh` guarda cada día la base de datos y las fotos en `~/respaldos/entrelazados` y conserva 7 días. Cómo programarlo con `cron` y cómo restaurar: [`backend/scripts/LEEME.md`](backend/scripts/LEEME.md).

> Las fotos viven en `backend/entrelazados-api/uploads/` en la VM: `git pull` no las toca, pero si se pierde la VM solo quedan las de los respaldos.

---

## Flujo de trabajo con git

- **`master`** es la rama principal, con la app actual (Express + MySQL). Solo recibe correcciones urgentes, siempre por *pull request*.
- **`migracion-nextjs`** es la rama de larga duración donde se convierte la app a Next.js (ver [ROADMAP](ROADMAP.md)). Se cierra cuando todo esté convertido.
  - Nadie hace *push* directo: cada pieza se trabaja en una rama corta **`nextjs/<tema>`** (por ejemplo `nextjs/proyecto-base`, `nextjs/pagina-login`) que sale de `migracion-nextjs` y vuelve por *pull request* con **squash** (un commit por pieza).
  - Cuando algo entra a `master`, se abre un *pull request* `master → migracion-nextjs` para mantenerlas sincronizadas.
  - Para cerrarla: *pull request* `migracion-nextjs → master` con **merge commit** (conserva la historia), etiqueta `v2.0` y se borra la rama. La lista de lo que debe estar terminado está en el ROADMAP.
- `master` y `migracion-nextjs` están protegidas: exigen *pull request* y las pruebas en verde.
- La rama `main` ya no se usa (la versión 14 se mezcló a `master` en el PR #14).
- Antes de subir cambios, corre las pruebas (`backend/pruebas/LEEME.md`). Al subirlos, GitHub Actions las vuelve a correr; revisa que el *pull request* tenga ✅ antes de mezclarlo.
- Si agregas o cambias una ruta, actualiza `docs/openapi.yaml`: la prueba `rutas_documentadas` falla si una ruta no está documentada.

---

## Autor

**Erick Sarria** · [@ericksarria07](https://github.com/ericksarria07)
