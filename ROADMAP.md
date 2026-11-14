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
            │ Neon     │ │ Ably    │ │ QStash  │ │ Cloudinary   │
            │ Postgres │ │ tiempo  │ │ cierre  │ │ fotos + CDN  │
            │          │ │ real    │ │ subasta │ │ de imágenes  │
            └──────────┘ └─────────┘ └─────────┘ └──────────────┘
                   Upstash Redis (límites de peticiones) · Gemini · Correo (SMTP / Resend)
```

### Decisiones por componente

| Componente | Elección | Por qué | Alternativas descartadas |
|---|---|---|---|
| Dominio y DNS | **Cloudflare** (ericksv.com), registro `CNAME` en **nube gris** | El dominio ya está comprado ahí. La nube gris evita tener dos CDN en cadena | Proxy naranja delante de Vercel: doble caché, problemas con el certificado y con las IPs reales. Vercel lo desaconseja |
| Framework | **Next.js** (App Router) | Une frontend y API en un proyecto, SSR para el Mercado, despliegue nativo en Vercel | Seguir con Express en funciones serverless (no aprovecha la migración del frontend) |
| Hosting | **Vercel** | `git push` = despliegue, URLs de vista previa por PR, HTTPS automático | Cloudflare Workers: exige reescribir mucho más (Hono, Durable Objects, `bcryptjs`, sin Nodemailer) |
| Base de datos | **Neon** (Postgres serverless) | Plan gratis, ramas de BD para probar migraciones, integración con Vercel | D1 (SQLite): sin transacciones interactivas ni `FOR UPDATE`, que son clave para las pujas |
| Acceso a datos | **Drizzle ORM** + **`pg`** (node-postgres) con `attachDatabasePool` de `@vercel/functions` | Mapea snake_case ↔ camelCase y da tipos. `pg` es el driver que recomienda Neon para Vercel (Fluid compute reutiliza el pool entre peticiones) y permite transacciones interactivas con `FOR UPDATE` (probado con `npm run probar:neon`) | `@neondatabase/serverless`: Neon lo recomienda para entornos edge; su driver HTTP no tiene transacciones interactivas |
| Tiempo real | **Ably** (Pusher como equivalente) | Socket.IO no funciona en Vercel. Ably tiene buen plan gratis, SDK para React y canales privados | SSE desde Route Handlers (las funciones tienen duración máxima); Supabase Realtime (otra plataforma más) |
| Cierre de subastas | **QStash** (mensaje programado por subasta) + **cierre perezoso** + **Vercel Cron diario** | Cierra a la hora exacta y **no mantiene Neon despierto** | Cron cada minuto: gasta las horas de cómputo gratis de Neon y en Vercel Hobby el cron es diario |
| Fotos | **Cloudinary** | Miniaturas y WebP/AVIF automáticos, subida firmada directa desde el navegador (esquiva el límite de 4,5 MB de Vercel) | Google Cloud Storage (solo almacenamiento, más configuración); Vercel Blob o Cloudflare R2 (opciones válidas si se quiere solo almacenamiento) |
| Sesión | **Cookie httpOnly** con `jose` (o Auth.js) | El token no se puede robar con un XSS | JWT en `localStorage` (actual) |
| Límites de peticiones | **Upstash Redis** | En serverless la memoria no se comparte entre instancias | `express-rate-limit` en memoria (actual) |
| Tareas después de responder | **`after()`** de Next.js | Las 14 tareas que hoy se lanzan sin esperar (correos, alertas) se cortarían al congelarse la función | Lanzar sin esperar (actual) |

### Detalle: tiempo real con Ably
`servicios/tiempoReal.js` conserva su interfaz (`aTodos`, `aUsuario`) y por dentro publica en Ably:

| Hoy (Socket.IO) | Con Ably |
|---|---|
| Sala por usuario | Canal privado `private:usuario-{id}`, autorizado por `/api/ably/token` con la sesión |
| Emisión a todos (`subastas:cambio`) | Canal público `subastas` |
| Cliente en `sesion.js` | Hook de React (`useChannel`) en el layout |

### Detalle: cierre de subastas
1. **QStash:** al crear una subasta se programa un mensaje para su `FechaFin`, que llama a `POST /api/subastas/{id}/cerrar` (con firma verificada).
2. **Cierre perezoso:** al consultar una subasta vencida que sigue abierta, se cierra en ese momento.
3. **Vercel Cron diario:** barre y cierra cualquier subasta que se haya escapado.

Se reutiliza la lógica actual de `crearCierreSubastas` (`servicios/subastas.js`). Solo cambia quién la dispara.

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
- [ ] Crear cuentas en Ably, Upstash (QStash + Redis) y Cloudinary
- [ ] Buscar un respaldo de la BD y de las fotos de la VM vencida (si existe)

### Fase 1: Backend moderno, mismas páginas (≈ 26–37 días)
Objetivo: el sitio **funciona en Vercel** y se ve igual. Las páginas HTML actuales viven en `public/` de Next.js.

| # | Trabajo | Días |
|---|---|---|
| 1.1 | Crear el proyecto Next.js, copiar `public/`, configurar variables de entorno | 1 |
| 1.2 | Esquema Postgres en Neon (18 tablas, snake_case, Drizzle). ✅ Esquema SQL cargado y probado (`sql/esquema_postgres.sql`); falta pasarlo a Drizzle | 1–1.5 |
| 1.3 | Reescribir las 121 consultas (ver sección 3), `unaccent`, conversión de `COUNT` | 5–8 |
| 1.4 | Funciones auxiliares en lugar de los middlewares: sesión, roles, errores, validación | 1.5–2 |
| 1.5 | 16 routers → Route Handlers `/api/*` (los servicios se reutilizan) | 4–6 |
| 1.6 | Tiempo real con Ably (`tiempoReal.js` + `sesion.js`) | 2–3 |
| 1.7 | Cierre de subastas: QStash + cierre perezoso + Cron diario | 1.5–2.5 |
| 1.8 | Fotos en Cloudinary con subida firmada | 1.5–2.5 |
| 1.9 | Límites de peticiones con Upstash, `after()` para correos y avisos, Swagger | 1.5–2 |
| 1.10 | Adaptar las pruebas de la API a Postgres y actualizar GitHub Actions | 3–5 |
| 1.11 | Dominio `entrelazados.ericksv.com`, migrar datos, prueba completa | 1–2 |
| 1.12 | Proceso de CD: vistas previas por PR, producción al fusionar en `master` solo con pruebas en verde, migraciones automáticas y rollback (ver sección 11) | 1–2 |

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
| Upstash | Free (QStash + Redis) | Mensajes por día / comandos por día |
| Cloudinary | Free | Créditos mensuales (almacenamiento + descargas + transformaciones) |

Los planes gratuitos cambian seguido: revisar las páginas de precios antes de empezar cada fase.

---

## 7. Ventajas esperadas

1. **Seguridad:** HTTPS automático, sesión en cookie httpOnly y parches de infraestructura a cargo del proveedor.
2. **Cero servidores que mantener:** sin VM, PM2 ni cron. Despliegue con `git push`, vistas previas por PR, respaldos y ramas de BD en Neon.
3. **Escala sola:** Vercel, Ably y Cloudinary absorben los picos. Las subastas cierran a la hora exacta.
4. **Más rápido:** imágenes optimizadas por Cloudinary, SSR en el Mercado, contenido servido desde el borde.
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
- **Los límites de Kan** (por minuto y por día) siguen aplicando: pasan a Upstash como el resto.
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
| **Variables por entorno** | En Vercel, valores separados para *Production*, *Preview* y *Development*: BD, Ably, Cloudinary (carpeta por entorno), QStash, Gemini. Las vistas previas nunca usan las claves de producción |
| **Tareas programadas solo en producción** | Vercel Cron y los mensajes de QStash apuntan únicamente al dominio de producción |
| **Prueba de humo** | Después de desplegar, un paso que consulta `GET /api/salud` (responde si la app y la BD contestan). Si falla, se avisa y se hace rollback |
| **Rollback** | **Instant Rollback** de Vercel: volver a la versión anterior con un clic o con `vercel rollback`, sin reconstruir |
| **Notificaciones** | Estado del despliegue en el PR (Vercel lo comenta solo) y aviso por correo o Discord si falla producción |

### Dos formas de armarlo
| Opción | Cómo | Cuándo |
|---|---|---|
| **A. Integración Git de Vercel + protección de rama** *(recomendada)* | Vercel construye y despliega solo; GitHub bloquea la fusión si el CI falla; un workflow aparte corre las migraciones al fusionar | Lo más simple; suficiente para este proyecto |
| B. Despliegue desde GitHub Actions | Se desactiva el despliegue automático de Vercel; el workflow hace pruebas → migraciones → `vercel build` → `vercel deploy --prebuilt --prod` (con los secretos `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`) | Si se necesita control total del orden, por ejemplo garantizar que la migración termine antes del despliegue |

### Checklist
- [ ] Conectar el repo de GitHub al proyecto de Vercel
- [ ] Activar la integración Neon ↔ Vercel (ramas de BD para las vistas previas)
- [ ] Protección de rama en `master`: CI obligatorio, sin push directo
- [ ] Adaptar `pruebas.yml` a Postgres y sumar lint
- [ ] Workflow de migraciones al fusionar en `master`
- [ ] Endpoint `/api/salud` y prueba de humo después del despliegue
- [ ] Variables de entorno separadas por entorno en Vercel
- [ ] Documentar en el README cómo hacer rollback
