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
| 1.12 | Proceso de CD: vistas previas por PR, producción al fusionar en `master` solo con pruebas en verde, migraciones automáticas y rollback (ver sección 11). ✅ Rama protegida con los 5 checks; ramas de Neon por vista previa (integración Neon ↔ Vercel, en un proyecto aparte y vacío: sin datos reales y con el esquema creado por las migraciones) y sin variables de producción en Preview; migraciones en el build de Vercel (`npm run vercel-build`); prueba de humo `humo.yml` después de cada despliegue (solo avisa); rollback documentado en el README | 1–2 |

En esta fase el JWT se queda en `localStorage`, para no tocar las páginas. Pasa a cookie en la Fase 2.

### Fase 2: Páginas a React, una por una (≈ 25–35 días)
Cada página migrada se despliega sola. El orden va de la más simple a la más compleja:

| # | Página o pieza | Líneas hoy | Días |
|---|---|---|---|
| 2.1 | Layout común: menú, tema oscuro, sesión (pasa a cookie httpOnly), campana, widget de Kan | ~940 de JS + CSS | 3–4 |
| 2.2 | `login`, `unirse`, `restablecer`, `verificar`, `comprobante` | ~1.950 | 2.5–4 |
| 2.3 | `perfil`, `index`, `preview` | ~2.200 | 3–4 |
| 2.4 | `reportes`, `admin` (`react-chartjs-2`, SheetJS) | ~1.400 | 4–6 |
| 2.5 | `dashboard` | 1.206 | 3–4 |
| 2.6 | `chat` | 1.260 | 3–4 |
| 2.7 | `mercado` (`react-leaflet`, subastas en vivo, formulario con IA) | 2.379 | 5–7 |
| 2.8 | Pruebas E2E con Playwright para los flujos clave: publicar, pujar, cerrar, chatear | | 2–3 |
| 2.9 | *(Opcional)* Kan y el asistente de IA con **Vercel AI SDK**: respuestas en streaming, historial y salidas tipadas (ver sección 10). No incluido en el total | ~600 (`kan.js` + `asistenteIA.js` + widget) | 2.5–4 (+1–2 con herramientas) |

### Total
| | Días |
|---|---|
| Fase 1 | 26–37 |
| Fase 2 | 25–35 |
| QA, despliegue y corrección de errores | 4–9 |
| **Total** | **≈ 55–81 días (3–4 meses, una persona)** |

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
- [ ] Fijar las versiones de las dependencias de CDN (`@tabler/icons-webfont@latest`) o instalarlas con npm

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
