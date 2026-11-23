# 🗺️ Roadmap: EntreLazados en arquitectura serverless

Plan para pasar EntreLazados de un monolito Express en una VM a **Next.js en Vercel**, con base de datos **Postgres en Neon**, servido en **https://entrelazados.ericksv.com**.

> Estado: **planificación**. Todavía no se ha migrado código.
> Última actualización: 2026-11-14

---

## 1. Punto de partida

| Pieza | Hoy |
|---|---|
| Hosting | VM Ubuntu 24.04 en Azure (de la escuela, **ya vencida**), PM2, puerto 3000, HTTP sin TLS |
| Backend | Node ≥ 20, **Express 5**, CommonJS, 16 routers (`rutas/`, ~1.950 líneas) y servicios (`servicios/`, ~2.560 líneas) |
| Frontend | 13 páginas **HTML + JS vanilla** en `public/` (~10.400 líneas con JS y CSS en línea). Chart.js, Leaflet y Tabler Icons por CDN |
| Base de datos | **MySQL 8** con `mysql2`, SQL a mano (121 consultas, 18 tablas), migraciones `migracion_vN.sql` aplicadas a mano |
| Tiempo real | **Socket.IO** (pujas en vivo, chat, notificaciones) |
| Cierre de subastas | `setInterval` dentro del proceso, cada 60 s |
| Fotos | Disco local (`uploads/`), multer con `memoryStorage` |
| Sesión | JWT en `localStorage`, enviado como `Authorization: Bearer` |
| Correo / IA | Nodemailer (SMTP) / Google Gemini (`@google/genai`) |
| Pruebas | `node --test` (unitarias) y 274 pruebas de integración contra MySQL, en GitHub Actions |

### Por qué no se puede subir tal cual a Vercel
Vercel ejecuta **funciones serverless**: no hay un proceso permanente ni disco persistente. Eso rompe cuatro piezas:

1. **Socket.IO** necesita conexiones abiertas durante mucho tiempo.
2. **`setInterval`**: no hay proceso vivo que lo ejecute.
3. **`uploads/`**: el disco de cada función es temporal.
4. **MySQL local**: hace falta una base de datos externa.

---

## 2. Arquitectura objetivo

```
                         ┌──────────────────────────────┐
  Usuario ── HTTPS ────▶ │ Cloudflare DNS (nube gris)   │  entrelazados.ericksv.com
                         └──────────────┬───────────────┘  CNAME → cname.vercel-dns.com
                                        ▼
                ┌───────────────────────────────────────────────┐
                │ Vercel                                        │
                │  Next.js (App Router)                         │
                │   • Páginas React (SSR / cliente)             │
                │   • Route Handlers  /api/*                    │
                │   • after() para correos y avisos             │
                │   • Vercel Cron (barrido diario)              │
                └──┬──────────┬──────────┬──────────┬───────────┘
                   │          │          │          │
                   ▼          ▼          ▼          ▼
            ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐
            │ Neon     │ │ Ably    │ │ Cron    │ │ Vercel Blob  │
            │ Postgres │ │ tiempo  │ │ cierre  │ │ fotos + CDN  │
            │          │ │ real    │ │ subasta │ │ de imágenes  │
            └──────────┘ └─────────┘ └─────────┘ └──────────────┘
                   Gemini · Correo (SMTP / Resend)
```

### Decisiones por componente

| Componente | Elección | Por qué | Alternativas descartadas |
|---|---|---|---|
| Dominio y DNS | **Cloudflare** (ericksv.com), registro `CNAME` en **nube gris** | El dominio ya está comprado ahí. La nube gris evita tener dos CDN en cadena | Proxy naranja delante de Vercel: doble caché, problemas con el certificado y con las IPs reales. Vercel lo desaconseja |
| Framework | **Next.js** (App Router) | Une frontend y API en un proyecto, SSR para el Mercado, despliegue nativo en Vercel | Seguir con Express en funciones serverless (no aprovecha la migración del frontend) |
| Hosting | **Vercel** | `git push` = despliegue, URLs de vista previa por PR, HTTPS automático | Cloudflare Workers: exige reescribir mucho más (Hono, Durable Objects, `bcryptjs`, sin Nodemailer) |
| Base de datos | **Neon** (Postgres serverless) | Plan gratis, ramas de BD para probar migraciones, integración con Vercel | D1 (SQLite): sin transacciones interactivas ni `FOR UPDATE`, que son clave para las pujas |
| Acceso a datos | **Drizzle ORM** (esquema y migraciones) + **`pg`** (node-postgres; las rutas escriben su SQL a mano con `$1, $2…`) con `attachDatabasePool` de `@vercel/functions` | Mapea snake_case ↔ camelCase y da tipos. `pg` es el driver que recomienda Neon para Vercel (Fluid compute reutiliza el pool entre peticiones) y permite transacciones interactivas con `FOR UPDATE` (probado con `npm run probar:neon` en `web/`) | `@neondatabase/serverless`: Neon lo recomienda para entornos edge; su driver HTTP no tiene transacciones interactivas |
| Tiempo real | **Ably** (Pusher como equivalente) | Socket.IO no funciona en Vercel. Ably tiene buen plan gratis, SDK para React y canales privados | SSE desde Route Handlers (las funciones tienen duración máxima); Supabase Realtime (otra plataforma más) |
| Cierre de subastas | **Cierre perezoso** + **Vercel Cron diario** | Sin servicio nuevo y **no mantiene Neon despierto**. El ganador se entera cuando alguien usa el sitio o, a más tardar, con el cron del día | QStash (cierra a la hora exacta, pero es otra cuenta); cron cada minuto (gasta las horas gratis de Neon y en Vercel Hobby el cron es diario) |
| Fotos | **Vercel Blob** (`@vercel/blob`, store `entrelazados-fotos`) | Las fotos siguen llegando al servidor como hoy, así que las páginas no cambian. La página ya las reduce a 1600 px, y 5 fotos caben en el límite de 4,5 MB por petición. Sin cuenta nueva: es parte de Vercel. En tu máquina y en las pruebas se guardan en disco (`web/lib/fotos.ts`) | Cloudinary (miniaturas automáticas, pero cambia la subida y es otra cuenta); Google Cloud Storage; Cloudflare R2 |
| Sesión | **Cookie httpOnly** con `jose` (o Auth.js) | El token no se puede robar con un XSS | JWT en `localStorage` (actual) |
| Límites de peticiones | **En memoria** (`web/lib/limites.ts`, sin `express-rate-limit`) | Sin servicio ni paquete nuevo. En Vercel cada instancia cuenta por su lado y empieza de cero al arrancar: el límite es aproximado, y se aceptó así | Upstash Redis (otra cuenta y otra dependencia solo para esto); tabla en Postgres (límite exacto, una consulta más por intento) |
| Tareas después de responder | **`after()`** de Next.js | Las 14 tareas que hoy se lanzan sin esperar (correos, alertas) se cortarían al congelarse la función | Lanzar sin esperar (actual) |

### Detalle: tiempo real con Ably
✅ `web/lib/tiempo-real.ts` conserva la interfaz (`aTodos`, `aUsuario`) y publica en Ably después de responder. La cuenta cobra por usuario activo (MAU), así que exige los SDK nuevos: `@ably/pubsub-server` en la API y `@ably/pubsub-device` en el navegador. El paquete `ably` se rechaza.

| Express (Socket.IO) | Next.js (Ably) |
|---|---|
| Sala por usuario | Canal `<prefijo>:usuario:<id>`. El permiso de solo lectura lo firma `GET /api/tiempo-real/token` con la sesión |
| Emisión a todos (`puja:nueva`, `subastas:cambio`) | Canal `<prefijo>:publico` |
| Cliente en `sesion.js` | `sesion.js` carga `@ably/pubsub-device` desde unpkg y emite los mismos eventos `entrelazados:<evento>`. En la Fase 2 pasa a un hook de React |

El prefijo (`ABLY_CANAL_PREFIJO`, por defecto `VERCEL_ENV`) separa producción, vistas previas, tu máquina y cada corrida de pruebas. Llaves creadas con la CLI de Ably en la app "Leather marketplace": `entrelazados-api` (Vercel, production y preview) y `entrelazados-pruebas` (`web/.env.local`). Sin `ABLY_API_KEY`, el tiempo real queda apagado y las páginas siguen preguntando cada cierto tiempo. Las dos llaves tienen activados los "revocable tokens" (Control API de Ably): al suspender o eliminar una cuenta, `revocarTiempoReal()` revoca sus permisos y Ably la desconecta al instante.

### Detalle: cierre de subastas
✅ `web/lib/cierre-subastas.ts`, con la misma lógica de `crearCierreSubastas` (`servicios/subastas.js`). Solo cambia quién la dispara:
1. **Cierre perezoso:** al listar subastas, pujar, ver los tratos o abrir el dashboard se cierran las vencidas, como mucho una vez cada 15 s por instancia. En tratos y dashboard se espera al cierre, para que el trato aparezca enseguida; en lo demás va después de responder.
2. **Vercel Cron diario** (`web/vercel.json`, 06:00 UTC = medianoche en Nicaragua): `GET /api/cron/cerrar-subastas`, protegido con `CRON_SECRET`.
3. **A mano:** `POST /api/admin/subastas/cerrar-vencidas`.

---

## 3. Trampas conocidas al pasar de MySQL a Postgres

1. **Mayúsculas en los nombres:** Postgres convierte a minúsculas los nombres sin comillas (`UsuarioID` regresa como `usuarioid`). Hay ~90 accesos tipo `c.NombreRazonSocial` en el frontend y ~80 nombres distintos en el backend. **Decisión:** pasar el esquema a snake_case y que Drizzle los mapee.
2. **Búsquedas sin acentos ni mayúsculas:** MySQL encuentra "Café" al buscar "cafe" gracias a la collation. En Postgres hacen falta `ILIKE` y la extensión `unaccent`. Afecta al buscador del Mercado y a las alertas.
3. **`COUNT()` devuelve `bigint`**, que el driver entrega como string (`"5"`). Hay que convertirlo, o los indicadores del dashboard fallan sin avisar.
4. **Conversiones puntuales:**

| MySQL | Postgres | Veces |
|---|---|---|
| `?` | `$1, $2…` (o el ORM) | todas |
| `insertId` / `affectedRows` | `RETURNING` / `rowCount` | 10 / 12 |
| `DATE_FORMAT` | `to_char` | 5 |
| `INTERVAL` | sintaxis distinta | 5 |
| `IF()` | `CASE` | 4 |
| `REGEXP` | `~*` | 5 |
| `INSERT IGNORE` | `ON CONFLICT DO NOTHING` | 1 |
| `GROUP_CONCAT` | `string_agg` | 1 |
| `TINYINT(1)` / `AUTO_INCREMENT` / `ON UPDATE` | `boolean` / `identity` / trigger | 10 / 17 / 1 |

5. **Transacciones con `FOR UPDATE`** (12 usos, incluida la validación atómica de pujas): funcionan con `pg` por la conexión con pooler (`DATABASE_URL`). Probado con `npm run probar:neon`: dos pujas simultáneas, la segunda espera el bloqueo y se rechaza.

---

## 4. Fases

Estimaciones en días de trabajo de una persona que conoce el código y sabe React y Next.js. Si alguno es nuevo, sumar un 25–40 %.

### Fase 0: Preparación ✅ (hecho)
- [x] Comprar el dominio **ericksv.com** en Cloudflare
- [x] Instalar Wrangler e iniciar sesión
- [x] Instalar el plugin de Cloudflare para Claude Code (skills + MCP)
- [x] Crear la cuenta de Vercel, instalar Vercel CLI e iniciar sesión
- [ ] Activar 2FA en Vercel y en Cloudflare
- [x] Crear la cuenta y el proyecto de Neon, con el esquema cargado (PR #13)
- [x] Cuenta de Ably con sus llaves (`ABLY_API_KEY` en Vercel). ✅ Blob store `entrelazados-fotos` creado en Vercel
- [ ] Buscar un respaldo de la BD y de las fotos de la VM vencida (si existe)

### Fase 1: Backend moderno, mismas páginas (≈ 26–37 días)
Objetivo: el sitio **funciona en Vercel** y se ve igual. Las páginas HTML actuales viven en `public/` de Next.js.

| # | Trabajo | Días |
|---|---|---|
| 1.1 | Crear el proyecto Next.js, copiar `public/`, configurar variables de entorno. ✅ `web/` con Next.js 16, páginas copiadas, `/api/salud` contra Neon, proyecto en Vercel | 1 |
| 1.2 | Esquema Postgres en Neon (18 tablas, snake_case, Drizzle). ✅ `web/db/esquema.ts` + migraciones de Drizzle aplicadas en Neon y probadas (`npm run probar:neon` en `web/`) | 1–1.5 |
| 1.3 | Reescribir las 121 consultas (ver sección 3), `unaccent`, conversión de `COUNT`. SQL a mano con `pg`. ✅ Todas las consultas portadas (las 16 rutas de Express) | 5–8 |
| 1.4 | Funciones auxiliares en lugar de los middlewares: sesión, roles, errores, validación. ✅ `web/lib/` (`http`, `sesion`, `limites`, `correo`, `config`, `utilidades`) | 1.5–2 |
| 1.5 | 16 routers → Route Handlers `/api/*` (los servicios se reutilizan). ✅ Toda la API en `web/app/api/` (56 rutas): cuentas, ofertas, subastas y pujas, cierre de subastas, tratos, dashboard, chat, campana, favoritos y alertas, mapa, Kan, asistente de IA, reportes y el panel de admin (usuarios, correos, estados, eliminar cuentas, categorías y moderación). Las 32 secciones de `npm run test:api` están activas | 4–6 |
| 1.6 | Tiempo real con Ably (`tiempoReal.js` + `sesion.js`). ✅ `web/lib/tiempo-real.ts`, `/api/tiempo-real/token` y `sesion.js`; sección 23 reescrita (entrega y permisos de canal) | 1–1.5 |
| 1.7 | Cierre de subastas: cierre perezoso + Cron diario. ✅ También tratos (`/api/tratos`, estado, calificación y comprobante) y `/api/dashboard`; secciones 15, 16 y 20 activas | 1–1.5 |
| 1.8 | Fotos en Vercel Blob. ✅ `web/lib/fotos.ts` (Blob en Vercel, disco en las pruebas) | 1 |
| 1.9 | Límites de peticiones en memoria, `after()` para correos y avisos, Swagger. ✅ Límites de login, registro, recuperación, Kan, fotos e IA (sección 32 activa) y `after()` en todos los avisos; Swagger en `/api/docs` y `/api/openapi.json` (`web/docs/openapi.yaml`, revisado por la sección 12) | 1–1.5 |
| 1.10 | Adaptar las pruebas de la API a Postgres y actualizar GitHub Actions. ✅ Suite portada a `web/pruebas/api/` (32 secciones, SQL en Postgres), job "API en Next.js (Postgres)" en el CI; cada rama de rutas (1.3/1.5) activa sus secciones, en el orden de la suite | 3–5 |
| 1.11 | Dominio `entrelazados.ericksv.com`, migrar datos, prueba completa. ✅ Dominio en Vercel; sin datos que migrar (la VM venció sin respaldo: se arrancó de cero en Neon); `npm run admin:crear` para la cuenta de administrador; `npm run recorrido` (Playwright) recorre las 14 páginas en producción con capturas y cuentas temporales que borra al final: 38/38 pasos. Gemini encendido en producción (`GEMINI_MODELO=gemini-3.5-flash-lite`, plan gratis): Kan, "Completar con IA" y el precio sugerido responden con IA y tienen su paso en el recorrido. El recorrido es la base de las pruebas E2E de la 2.8 | 1–2 |
| 1.12 | Proceso de CD: vistas previas por PR, producción al fusionar en `master` solo con pruebas en verde, migraciones automáticas y rollback (ver sección 11). ✅ Rama protegida con los 5 checks; ramas de Neon por vista previa copiadas de `production` (integración Neon ↔ Vercel instalada desde Neon) y sin variables de producción en Preview; migraciones en el build de Vercel (`npm run vercel-build`); prueba de humo `humo.yml` después de cada despliegue (solo avisa); rollback documentado en el README | 1–2 |

En esta fase el JWT se quedó en `localStorage`, para no tocar las páginas. Desde la 2.1 va en una cookie httpOnly.

### Fase 2: Páginas a React, una por una (≈ 29–40 días) · borrador
Cada página migrada se despliega sola. El orden va de la más simple a la más compleja. El detalle de cada pieza (qué tiene, qué API usa y cuándo está terminada) está en la **sección 13**.

| # | Página o pieza | Líneas hoy | Días |
|---|---|---|---|
| 2.1 | ✅ Base común: sesión en cookie httpOnly, protección CSRF, layout raíz (letra, íconos, tema oscuro) y la primera página: `verificar`. El menú, la campana, el tiempo real y Kan llegan con la primera página que los muestra | ~1.100 de JS + CSS | 3–4 |
| 2.2 | ✅ `login`, `unirse`, `restablecer`, `comprobante` | ~1.770 | 2.5–4 |
| 2.3 | ✅ `preview` (portada `/`), `index` (`/inicio`), `perfil`, `perfil-publico`, más la cabecera, la campana, el tiempo real y Kan en React | ~2.660 | 3–4 |
| 2.4 | ✅ `admin`, `reportes` (Chart.js y ExcelJS de npm) | ~1.410 | 4–6 |
| 2.5 | ✅ `dashboard` | 1.223 | 3–4 |
| 2.6 | ✅ `chat` | 1.260 | 3–4 |
| 2.7 | ✅ `mercado`: ofertas, subastas en vivo, favoritos, alertas, publicar con IA y mapa (Leaflet de npm) | ~2.490 | 5–7 |
| 2.8 | ✅ Pruebas E2E con `@playwright/test`: publicar, pujar, cerrar y chatear | | 2–3 |
| 2.9 | *(Opcional)* Kan y el asistente de IA con **Vercel AI SDK**: streaming y salidas tipadas (ver sección 10). No incluido en el total | ~600 | 2.5–4 |

### Total
| | Días |
|---|---|
| Fase 1 | 26–37 |
| Fase 2 | 29–40 |
| QA, despliegue y corrección de errores | 4–9 |
| **Total** | **≈ 59–86 días (3–4 meses, una persona)** |

---

## 5. Configuración del subdominio

1. Vercel → **Project → Settings → Domains** → agregar `entrelazados.ericksv.com`.
2. Cloudflare → **DNS → Add record**:

   | Tipo | Nombre | Destino | Proxy |
   |---|---|---|---|
   | `CNAME` | `entrelazados` | `cname.vercel-dns.com` | **Nube gris** (solo DNS) |

3. Vercel verifica el dominio y emite el certificado HTTPS.
4. Cambiar `APP_URL` a `https://entrelazados.ericksv.com` (enlaces de los correos).

La raíz `ericksv.com` queda libre para un portafolio u otros proyectos.

---

## 6. Costos y límites (planes gratis, verificar antes de decidir)

| Servicio | Plan | Límite a vigilar |
|---|---|---|
| Cloudflare | Dominio ~US$10/año, DNS gratis | n/a |
| Vercel | Hobby (gratis) | **Solo uso no comercial**. Si EntreLazados se vuelve negocio: Pro, US$20/mes. Duración máxima de las funciones (Kan / Gemini) |
| Neon | Free | ~0,5 GB de almacenamiento, suspensión tras minutos sin uso, horas de cómputo limitadas |
| Ably | Free | Conexiones simultáneas y mensajes por mes |
| Vercel Blob | Incluido en Hobby | Almacenamiento y transferencia por mes |

Los planes gratuitos cambian seguido: revisar las páginas de precios antes de empezar cada fase.

---

## 7. Ventajas esperadas

1. **Seguridad:** HTTPS automático, sesión en cookie httpOnly y parches de infraestructura a cargo del proveedor.
2. **Cero servidores que mantener:** sin VM, PM2 ni cron. Despliegue con `git push`, vistas previas por PR, respaldos y ramas de BD en Neon.
3. **Escala sola:** Vercel, Ably y Vercel Blob absorben los picos. Las subastas cierran a la hora exacta.
4. **Más rápido:** fotos servidas desde la CDN de Vercel Blob, SSR en el Mercado, contenido servido desde el borde.
5. **Más mantenible:** componentes React en lugar de HTML de 2.000+ líneas, tipos con TypeScript y Drizzle, y un stack con alta demanda laboral.

## 8. Riesgos

- **Dependencia de 5–6 servicios externos**, cada uno con sus límites gratuitos y la posibilidad de que cambien.
- **Curva de aprendizaje** si React, Next.js o Postgres son nuevos.
- **La migración de SQL** (mayúsculas, acentos, `COUNT`) puede introducir errores que no se notan a simple vista. Las pruebas de integración son la red de seguridad: hay que adaptarlas **antes** de reescribir las consultas.
- **Vercel Hobby no permite uso comercial.**

## 9. Mejoras que se resuelven con la migración

Estas salieron del análisis del código actual:

- [x] HTTPS (por Vercel)
- [x] Encabezados de seguridad y CSP (se configuran en `next.config`; más fácil sin `onclick` en línea)
- [x] Separar el JS de los HTML (componentes React)
- [x] Migraciones automáticas (Drizzle Kit)
- [ ] Monitoreo: endpoint `/api/salud` y un monitor externo
- [x] Fijar las versiones de las dependencias de CDN (`@tabler/icons-webfont@latest`) o instalarlas con npm (Fase 2: todo por npm con versión fija; Dependabot avisa de las nuevas)

---

## 10. Nota: evaluación del Vercel AI SDK para hablar con la IA

### Cómo funciona hoy
| Pieza | Archivo | Cómo usa Gemini |
|---|---|---|
| **Kan** (chat del asistente) | `servicios/kan.js`, `rutas/kan.js` → `POST /api/chat/ia` | `generateContent` con instrucciones de sistema y un resumen del mercado sacado de la BD. **Una sola pregunta por vez, sin historial ni streaming**: el usuario espera la respuesta completa (hasta 600 tokens). Si Gemini falla, responde con mensajes fijos |
| **Asistente al publicar** | `servicios/asistenteIA.js`, `rutas/ia.js` → `/api/ia/publicacion` y `/api/ia/precio` | Salida JSON con esquema (`responseSchema`), foto enviada como imagen (`inlineData`), y la respuesta se valida a mano |

### Qué aportaría el AI SDK (`ai` + `@ai-sdk/google`)
| Uso | Herramienta del SDK | Beneficio |
|---|---|---|
| Respuestas de Kan en streaming | `streamText` en el Route Handler + `useChat` en React | El texto aparece mientras se genera. Mejor experiencia, y la función empieza a responder de inmediato, lejos de la duración máxima |
| Conversación con memoria | `useChat` maneja el historial de mensajes | Kan recordaría lo que el usuario preguntó antes; hoy cada pregunta es independiente |
| Herramientas (*tool calling*) | `tools` con esquemas Zod | En vez de meter todo el contexto del mercado en el prompt, Kan llamaría funciones reales: `buscarOfertas`, `misSubastas`, `precioPromedio(categoria)`. Respuestas más precisas y prompts más cortos |
| Descripción y precio al publicar | `generateObject` con esquema Zod (imagen incluida) | Reemplaza el esquema JSON y la validación manual por un objeto **tipado y validado** |
| Independencia del proveedor | Proveedores intercambiables | Pasar de Gemini a otro modelo (Claude, OpenAI…) es cambiar una línea. Opcionalmente, **Vercel AI Gateway** suma respaldo automático entre modelos y métricas de uso |

### Esfuerzo
| Trabajo | Días |
|---|---|
| Kan con `streamText` + `useChat` (widget y página de chat), conservando las respuestas fijas de respaldo y los límites de uso | 1.5–2.5 |
| Asistente de publicación con `generateObject` + Zod | 1–1.5 |
| *(Opcional)* Herramientas para Kan | 1–2 |

### Puntos a cuidar
- **`useChat` es de React**, así que conviene hacerlo en la **Fase 2**, junto con el widget de Kan (2.1) y la página de chat (2.6). En la Fase 1, `@google/genai` funciona tal cual en el runtime de Node de Vercel y no hace falta tocarlo.
- **Mantener el respaldo** de `respuestaFija` cuando Gemini falla (manejo de errores del stream).
- **Los límites de Kan** (por minuto y por día) siguen aplicando: se quedan en memoria como el resto.
- **El historial cuesta tokens:** limitar cuántos mensajes previos se envían.
- **El SDK cambia rápido** entre versiones mayores: fijar la versión.
- El SDK es open source y gratis. El costo sigue siendo el uso de Gemini (o del modelo que se elija).

### Recomendación
**Adoptarlo en la Fase 2.** Es un cambio acotado (~600 líneas entre servicio, ruta y widget). La mejora visible más grande es el streaming con historial; las salidas tipadas simplifican el asistente de publicación, y queda abierta la puerta a cambiar de modelo sin reescribir.

---

## 11. Nota: proceso de despliegue continuo (CD)

### Hoy
Hay **CI** (`.github/workflows/pruebas.yml`: unitarias en Node 20 y 22, e integración contra MySQL 8.0), pero el **despliegue es manual**: entrar por SSH a la VM, `git pull` y `pm2 restart 0`. Nada impide subir a producción un commit con pruebas en rojo, y las migraciones `migracion_vN.sql` se aplican a mano.

### Objetivo
**Ningún cambio llega a producción sin pasar las pruebas, y ningún despliegue requiere pasos manuales.**

```
  rama / PR ──▶ GitHub Actions (CI) ──▶ Vercel Preview  ──▶ revisión
                  │  lint + unitarias      URL única por PR
                  │  + integración         BD: rama de Neon
                  ▼
  merge a master (solo con CI en verde) ──▶ migraciones (Drizzle) ──▶ Vercel Production
                                                                      entrelazados.ericksv.com
                                                                          │
                                                       prueba de humo: GET /api/salud
                                                       si falla → Instant Rollback
```

### Piezas
| Pieza | Cómo |
|---|---|
| **Vistas previas por PR** | Integración de Vercel con GitHub: cada PR recibe su URL. La integración Neon ↔ Vercel crea una **rama de la BD por vista previa**, así que las pruebas nunca tocan los datos reales |
| **Producción solo con pruebas en verde** | **Protección de rama** en `master`: exigir que pasen los checks de CI (y una revisión) antes de fusionar. Vercel despliega producción al fusionar |
| **Migraciones automáticas** | Paso de CI con `drizzle-kit migrate` contra la BD de producción **antes** del despliegue. Las migraciones deben ser **compatibles hacia atrás** (primero agregar columnas, después quitar las viejas en otra versión) para que la versión anterior siga funcionando si hay rollback |
| **Variables por entorno** | En Vercel, valores separados para *Production*, *Preview* y *Development*: BD, Ably, Vercel Blob, Gemini. Las vistas previas nunca usan las claves de producción |
| **Tareas programadas solo en producción** | Vercel Cron solo corre en producción (`CRON_SECRET` y `APP_URL` existen solo ahí) |
| **Prueba de humo** | Después de desplegar, un paso que consulta `GET /api/salud` (responde si la app y la BD contestan). Si falla, se avisa y se hace rollback |
| **Rollback** | **Instant Rollback** de Vercel: volver a la versión anterior con un clic o con `vercel rollback`, sin reconstruir |
| **Notificaciones** | Estado del despliegue en el PR (Vercel lo comenta solo) y aviso por correo o Discord si falla producción |

### Dos formas de armarlo
| Opción | Cómo | Cuándo |
|---|---|---|
| **A. Integración Git de Vercel + protección de rama** *(recomendada)* | Vercel construye y despliega solo; GitHub bloquea la fusión si el CI falla; un workflow aparte corre las migraciones al fusionar | Lo más simple; suficiente para este proyecto |
| B. Despliegue desde GitHub Actions | Se desactiva el despliegue automático de Vercel; el workflow hace pruebas → migraciones → `vercel build` → `vercel deploy --prebuilt --prod` (con los secretos `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`) | Si se necesita control total del orden, por ejemplo garantizar que la migración termine antes del despliegue |

### Checklist
- [x] Conectar el repo de GitHub al proyecto de Vercel
- [x] Activar la integración Neon ↔ Vercel (ramas de BD para las vistas previas)
- [x] Protección de rama (`migracion-nextjs` mientras dure la migración; `master` al cerrarla): CI obligatorio, sin push directo
- [x] Adaptar `pruebas.yml` a Postgres y sumar lint
- [x] Migraciones al fusionar: en el build de Vercel (`vercel-build`), antes de que la versión nueva quede activa
- [x] Endpoint `/api/salud` y prueba de humo después del despliegue (`.github/workflows/humo.yml`)
- [x] Variables de entorno separadas por entorno en Vercel
- [x] Documentar en el README cómo hacer rollback

---

## 12. Rama de la migración

Todo el trabajo de las Fases 1 y 2 se hace en la rama de larga duración **`migracion-nextjs`**, que sale de `master` y se cierra cuando la app entera esté en Next.js. El detalle del flujo (ramas cortas `nextjs/<tema>`, squash, sincronización con `master`) está en el README, sección "Flujo de trabajo con git".

Mientras dure la migración, Vercel publica `migracion-nextjs` en `entrelazados.ericksv.com` (*Production Branch*), y cada *pull request* tiene su vista previa.

### Criterios para cerrar la rama
- [ ] Las 14 páginas (incluida `perfil-publico`, de la versión 14) en React
- [ ] Toda la API en Route Handlers, sobre Neon (✅ en `migracion-nextjs`); MySQL y Socket.IO retirados (al cerrar la migración)
- [ ] Pruebas adaptadas y en verde en el CI
- [ ] Sitio funcionando en `entrelazados.ericksv.com` desde la rama larga
- [ ] Carpeta Express (`backend/entrelazados-api`) eliminada o archivada

**Cierre:** *pull request* `migracion-nextjs → master` con merge commit, cambiar en Vercel la *Production Branch* a `master`, etiqueta `v2.0` y borrar la rama.

---

## 13. Detalle de la Fase 2 (borrador)

> **Borrador.** Las decisiones las tomó el autor el 2026-11-17 y pueden cambiar después de hablarlas con el equipo (issue #31). Antes de empezar cada pieza se revisa si algo cambió.

### Decisiones

| # | Tema | Elegido | Estado |
|---|---|---|---|
| D1 | Estilos | Se reusa el CSS actual: los `.css` compartidos como globales y el `<style>` de cada página como CSS Module | Decidido |
| D2 | URLs | Sin `.html` (`/mercado`), con redirección 308 que conserva el query string | Decidido |
| D3 | Sesión | Cookie httpOnly desde la 2.1, para todo el sitio | Decidido |
| D4 | Kan con AI SDK | Al final, como 2.9 opcional | Decidido |
| P1 | Datos | Server Components para la carga inicial; `fetch` a `/api/*` en componentes cliente para lo interactivo; sin librería extra | Propuesta |
| P2 | `.html` viejos | Se borran en el PR que los reemplaza | Propuesta |
| P3 | Librerías de CDN | Por npm y con versión fija (Tabler Icons, Chart.js, ExcelJS, Leaflet, Ably) | Propuesta |
| P4 | `perfil-publico` | En la 2.3 | Propuesta |

### Patrón para cada página
1. `app/(sitio)/<pagina>/page.tsx`: Server Component con la carga inicial, que lee la sesión de la cookie.
2. Lo interactivo va en componentes `"use client"`, en `app/(sitio)/<pagina>/_componentes/`.
3. El `<style>` de la página pasa a `page.module.css`.
4. JSX en lugar de `innerHTML` y `esc()`: React escapa solo.
5. Se agrega la redirección `/<pagina>.html → /<pagina>` en `next.config.ts` y se borra el `.html`.
6. Se ajusta el recorrido (`pruebas/recorrido/recorrido.mjs`). Se conservan los `id` actuales para tocar lo mínimo.

### Dependencias e hitos

```
2.1 Base ──┬─▶ 2.2 Cuenta ─▶ 2.3 Perfil y portada ─────────▶ HITO A
           ├─▶ 2.4 Admin y reportes ─┬─▶ 2.5 Dashboard ─┐
           └─▶ 2.6 Chat ─────────────┴──────────────────┴─▶ HITO B
                                        2.7 Mercado ─▶ 2.8 E2E ─▶ HITO C
                         2.9 Kan con streaming (opcional, después de 2.6)
```

| Hito | Qué se cumple | Días acumulados |
|---|---|---|
| **A** | Login, registro y páginas públicas en React; sesión en cookie | ~9–12 |
| **B** | Admin, reportes, dashboard y chat en React | ~22–30 |
| **C** | Mercado y E2E: las 14 páginas en React y ningún `.html` en `public/`. Se puede abrir `migracion-nextjs → master` | ~29–40 |

### 2.1 Base común · `nextjs/layout` · 3–4 días · ✅ sesión, layout raíz y `verificar`

> **Hecho:** sesión en cookie con `/api/sesion`, `/api/logout` y `proxy.ts`; páginas viejas sin token; layout raíz (letra, íconos con npm, tema sin parpadeo, "Saltar al contenido", `BotonTema`); `/verificar` en React; sección 33 de `test:api` (435/435).
> **Ajuste:** el menú, el menú de usuario, la campana, `useTiempoReal`, `useNoLeidos` y Kan en React se hacen junto con la **primera página que los muestra** (2.2/2.3). `verificar` no tiene cabecera, así que construirlos antes sería código sin una página para probarlo. Lo mismo para `ProveedorSesion`.

**Sesión (D3)**
- **`lib/sesion.ts`:** `exigirSesion()` lee la cookie `sesion` y, si no está, `Authorization: Bearer`. El Bearer queda para las pruebas, Swagger y clientes externos. Función nueva `leerSesionDesdeCookies()` para los Server Components.
- **`POST /api/login`:** pone la cookie (`HttpOnly; Secure; SameSite=Lax`) y deja de devolver el token.
- **Rutas nuevas:** `POST /api/logout` (borra la cookie) y `GET /api/sesion` (el usuario actual, o 401).
- **`proxy.ts`:** rechaza con 403 las escrituras a `/api/*` cuyo `Origin` sea de otro sitio (protección CSRF).
- **Páginas viejas, mientras convivan:**
  - `sesion.js` deja de manejar el token y "Cerrar sesión" llama a `/api/logout`;
  - `login.html` deja de guardar el token;
  - `kan.js` ata su memoria a la sesión con un identificador de `/api/sesion`.

**Layout**
- **`app/layout.tsx`:** CSS globales, Source Sans 3 con `next/font` y el script del tema en línea, para que no parpadee.
- **`app/(sitio)/layout.tsx`:** `Menu`, `MenuUsuario`, `Campana`, `BotonTema`, `Kan` y el globito de no leídos.
- **Ayudas del cliente (`lib/cliente/`):** `ProveedorSesion`, `useTiempoReal()` (Ably desde npm, con los mismos eventos) y `useNoLeidos()`.
- **Accesibilidad:** lo que hoy agrega `tema.js` al cargar (íconos ocultos para lectores, "Saltar al contenido") se escribe directo en los componentes.
- **Primera página:** `verificar` (187 líneas, pública, 2 rutas de la API).

**Terminado cuando:**
- no queda token en `localStorage`;
- las páginas viejas siguen pasando el recorrido;
- una sección nueva de `test:api` cubre cookie, logout y `Origin`;
- `/verificar.html` redirige a `/verificar`.

### 2.2 Páginas de cuenta · `nextjs/paginas-cuenta` · 2.5–4 días · ✅

> **Hecho:** `/login`, `/unirse`, `/restablecer` y `/comprobante` en React, con sus redirecciones desde `.html`; los correos enlazan a las URLs nuevas; `scripts/estilos-a-modulo.mjs` pasa el `<style>` de cada página a CSS Module. Además se corrigió el contraste del comprobante en modo oscuro (la hoja conserva sus colores de papel). El menú, la campana y Kan siguen para la 2.3: ninguna de estas páginas los tiene.

| Página | Líneas | API | Qué tiene |
|---|---|---|---|
| `login` | 449 | `/api/login`, `/api/reenviar-verificacion` | Formulario, aviso de correo sin verificar, redirección según el rol |
| `unirse` | 549 | `/api/registro` | Elegir rol, formulario y validación |
| `restablecer` | 508 | `/api/solicitar-recuperacion`, `/api/validar-token-recuperacion`, `/api/restablecer-password` | Pedir el correo, o la nueva contraseña con el token de la URL |
| `comprobante` | 265 | `/api/tratos/:id`, `/api/tratos/:id/comprobante` | Vista para imprimir |

**Terminado cuando:** registro → verificar → login → recuperar contraseña funcionan de punta a punta, incluidos los enlaces viejos de los correos (`verificar.html?token=…`).

### 2.3 Perfil y portada · `nextjs/perfil-portada` · 3–4 días · ✅

> **Hecho (2.3 a 2.8 en una sola rama, `nextjs/fase2`, un commit por pieza):** la cabecera, el buscador, el menú del usuario, la campana, el tiempo real (`ProveedorSitio` + `useEventoTiempoReal`), los no leídos y Kan quedaron en `web/componentes/sitio/`. La sesión se lee en el servidor en `app/(sitio)/layout.tsx` y las páginas que la exigen viven en `app/(sitio)/(con-sesion)/`. `perfil` resultó ser solo de lectura (no edita datos): se arma en el servidor igual que la portada y el perfil público.

| Página | Líneas | API | Qué tiene |
|---|---|---|---|
| `preview` → `/` | 649 | estadísticas públicas | Portada pública. Se quita el rewrite de `/` en `next.config.ts` |
| `index` → `/inicio` | 801 | `/api/ofertas`, `/api/perfil/:id` | Inicio con sesión: búsqueda y radio por kilómetros |
| `perfil` | 754 | `/api/perfil/:id` | Editar los datos propios |
| `perfil-publico` | 456 | `/api/usuarios/:id/publico`, `/api/ofertas`, `/api/subastas` | Perfil de otro usuario |

- La portada y el perfil público se arman en el servidor: cargan más rápido y los buscadores los leen.
- El buscador del menú, que hoy se repite en index, perfil y chat, pasa a un componente compartido.

**Terminado cuando:** se cumple el Hito A.

### 2.4 Admin y reportes · `nextjs/admin-reportes-react` · 4–6 días · ✅

> **Hecho:** en lugar de `react-chartjs-2` se usa `chart.js` directo (`lib/cliente/graficas.ts`), igual que hacían las páginas, y `lib/cliente/excel.ts` para las hojas de Excel. Las gráficas se redibujan al cambiar entre claro y oscuro (antes la página se recargaba).

| Página | Líneas | API | Qué tiene |
|---|---|---|---|
| `admin` | 707 | `/api/admin/*` | Métricas; usuarios paginados con búsqueda, suspender, eliminar y corregir/confirmar correo; ofertas; categorías |
| `reportes` | 704 | `/api/reportes` | KPIs, 6 gráficas, imprimir/PDF y exportar a Excel |

- **Librerías por npm:** `chart.js` + `react-chartjs-2` y `exceljs`, cargadas bajo demanda con `import()`.
- **Componentes que reusa el dashboard:** `Grafica`, `TablaPaginada`, `Toast` y `exportarExcel()`.
- **Protección:** `/admin` revisa el rol en el servidor y redirige si el usuario no es admin.

**Terminado cuando:**
- las gráficas y el Excel salen igual que antes;
- suspender a un usuario lo sigue desconectando en tiempo real.

### 2.5 Dashboard · `nextjs/dashboard-react` · 3–4 días · ✅
- **`dashboard.html`** (1.223 líneas): KPIs, mi actividad, mis tratos paginados (calificar, cambiar estado), gráficas, subastas, pujas, accesos, publicar material y exportar a Excel.
- **API:** `/api/dashboard`, `/api/tratos`, `/api/categorias`, `/api/ofertas`.
- **Reusa** los componentes de la 2.4. Las pujas y subastas se actualizan con `useTiempoReal()`.

**Terminado cuando:** los tratos, las calificaciones y el Excel funcionan y el recorrido pasa.

### 2.6 Chat · `nextjs/chat-react` · 3–4 días · ✅

> **Hecho:** Kan del chat conserva sus preguntas propias; lo que escribe el usuario se muestra como texto (antes se insertaba como HTML sin escapar).
- **`chat.html`** (1.260 líneas): contactos, conversación, enviar, no leídos por contacto, vista de celular (lista ↔ conversación) y Kan dentro del chat.
- **API:** `/api/chat/contactos`, `/api/chat/mensajes`, `/api/chat/enviar`, `/api/chat/ia`, `/api/perfil/:id`.
- **Tiempo real:** `useTiempoReal()` y `useNoLeidos()`.
- **Kan del chat y widget:** comparten la lógica (`lib/cliente/kan.ts`), con historial y memoria.

**Terminado cuando:**
- dos cuentas se escriben y el mensaje llega sin recargar;
- el globito de no leídos se actualiza;
- se cumple el Hito B, junto con la 2.5.

### 2.7 Mercado · dos PRs · 5–7 días · ✅

> **Hecho en un solo paso** (la rama completa se revisa junta). El mapa usa `leaflet` directo, cargado solo en el navegador, en lugar de `react-leaflet`. Los enlaces a pestañas siguen con el ancla de siempre (`/mercado#tab-auctions`), que es lo que guardan las notificaciones.

**El más grande:** `mercado.html`, `mercado.js`, `mercado-publicar.js`, `mercado-favoritos.js`, `mercado-mapa.js`, `categorias.js` y `mercado.css` (~2.490 líneas).

| PR | Rama | Qué incluye |
|---|---|---|
| 2.7a | `nextjs/mercado-ofertas` | Ofertas con filtros, categorías, paginación y kilómetros (carga inicial en el servidor); subastas con pujas en vivo (`puja:nueva`, `subastas:cambio`); favoritos y alertas |
| 2.7b | `nextjs/mercado-publicar-mapa` | Publicar y editar con fotos; "Completar con IA" y precio sugerido; mapa con `react-leaflet`, cargado solo en el navegador |

- **Pujas:** el servidor ya valida la puja aunque lleguen dos a la vez (`FOR UPDATE`). La página solo tiene que mostrar bien el aviso de "otro pujó más".
- **Enlaces a una pestaña:** siguen funcionando, por ejemplo `/mercado?tab=subastas`.

**Terminado cuando:** publicar con IA, pujar en vivo entre dos cuentas, el mapa, los favoritos y las alertas funcionan.

### 2.8 Pruebas E2E · `nextjs/e2e` · 2–3 días · ✅

> **Hecho de otra forma:** los E2E (`web/pruebas/e2e/`, `npm run e2e`) no corren contra la vista previa sino contra un `next start` del propio CI con un Postgres desechable, igual que `test:api`. Así no necesitan `VERCEL_BYPASS` ni la base de la vista previa, y no dependen de Gemini, Ably ni Blob. El job "E2E (Playwright)" corre en cada push. El recorrido (`npm run recorrido`) sigue siendo la revisión completa con capturas contra producción o una vista previa.
- **Base:** el recorrido pasa a `@playwright/test` (`web/pruebas/e2e/`), con 4 flujos: publicar, pujar entre dos cuentas, cerrar la subasta y crear el trato, y chatear.
- **CI:** un job corre los E2E contra la vista previa de cada PR. Necesita el secreto `VERCEL_BYPASS`. Empieza como informativo y después pasa a ser obligatorio.
- **Limpieza:** las cuentas temporales se borran al final, como hoy.

**Terminado cuando:** se cumple el Hito C y se pueden revisar los criterios de cierre de la sección 12.

### 2.9 *(Opcional)* Kan con Vercel AI SDK · `nextjs/kan-streaming` · 2.5–4 días
- **Kan:** `streamText` en `/api/chat/ia` y `useChat` en el widget y en el chat, conservando las respuestas fijas de respaldo y los límites de uso.
- **Asistente de publicación:** `generateObject` con un esquema Zod.
- **Antes de empezar:** AI SDK 7 pide Node 22 o superior; desde noviembre de 2026 el proyecto y el CI usan Node 26.

### Riesgos

| Riesgo | Mitigación |
|---|---|
| Cambios visuales al portar los estilos | Mismo CSS (D1); revisar modo claro, modo oscuro y celular en cada PR |
| `cacheComponents` y las lecturas de la cookie | Lo dinámico va dentro de `<Suspense>`; seguir la guía de `web/node_modules/next/dist/docs/` |
| Enlaces viejos en correos ya enviados | Redirecciones 308 que conservan el query string |
| Páginas viejas y nuevas conviviendo | La cookie funciona en las dos; `sesion.js` se queda hasta migrar la última página |
| El mercado es grande | Se divide en 2.7a y 2.7b |

### Verificación en cada PR

**Antes de mezclar:**
- los 5 checks del CI en verde;
- `npm run test:api`;
- `npm run recorrido` contra la vista previa;
- revisar a ojo modo claro, modo oscuro y celular.

**Después de mezclar:** la prueba de humo de producción tiene que quedar en verde.
