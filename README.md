# 🧵 Entrelazados - Plataforma Web y Asistente Virtual IA

**Entrelazados** es una plataforma web integral diseñada para la gestión, interacción y optimización de servicios mediante un backend estructurado en **Node.js/Express**, persistencia de datos relacional con **MySQL** y soporte de inteligencia artificial generativa con el SDK oficial de **Google GenAI**.

---

## 🚀 Características Principales y Funcionalidades

* **Autenticación y Gestión de Usuarios:** Sistema completo de registro, inicio de sesión y control de sesiones seguras.
* **Perfiles Personalizados:** Adaptación de interfaz y datos según el rol del usuario dentro de la plataforma.
* **Panel de Control (Dashboard):** Visualización centralizada de estadísticas, actividades recientes y gestión de contenido en tiempo real.
* **Integración con Asistente Virtual "Kan":** Asistente IA interactivo impulsado por **Google GenAI** capaz de resolver dudas, orientar flujos de trabajo y brindar asistencia contextualizada dentro del sistema.
* **API RESTful:** Arquitectura modular desacoplada con endpoints optimizados para el intercambio de información JSON entre el frontend web y el backend.

---

## 👥 Perfiles de Usuario

1. **Usuario / Cliente:**
   * Acceso a la interfaz principal y catálogo de servicios.
   * Gestión de información de perfil y preferencias.
   * Interacción directa con el asistente virtual Kan para soporte y consultas.

2. **Administrador:**
   * Gestión total sobre la base de datos de usuarios y registros de la plataforma.
   * Monitoreo de la actividad del sistema y gestión de integraciones de la API.

---

## 🤖 Asistente Virtual: Kan (Google GenAI)

**Kan** es el asistente virtual integrado en el ecosistema Entrelazados, construido utilizando `@google/genai`. 

* **Funciones:**
  * Respuestas en tiempo real para guía de usuarios.
  * Análisis contextual dentro de las rutas del backend.
  * Integración segura mediante clave API configurada en las variables de entorno (`.env`).

---

## 🛠️ Tecnologías Utilizadas

* **Frontend:** HTML5, CSS3, JavaScript (ES6+).
* **Backend:** Node.js, Express.js.
* **Base de Datos:** MySQL (`db_acd8d6_entrelazados`).
* **Inteligencia Artificial:** SDK `@google/genai` (Google Gemini API).
* **Gestor de Procesos:** PM2.
* **Servidor Nube / Infraestructura:** Microsoft Azure (Ubuntu Linux VM).

---

## ☁️ Arquitectura y Despliegue en Microsoft Azure

El proyecto fue desplegado en una máquina virtual Linux en la nube de Azure para garantizar disponibilidad continua y alto rendimiento.

### Configuración del Servidor:
* **Sistema Operativo:** Ubuntu Server en Azure VM.
* **IP Pública:** `57.156.69.249`
* **Puerto de Servicio:** `3000`

### Estructura de Red y Seguridad (Azure NSG / UFW):
* **Reglas del Grupo de Seguridad de Red (NSG) en Azure:**
  * **SSH (Puerto 22):** Permitido para la administración remota de la infraestructura.
  * **HTTP (Puerto 80):** Permitido para tráfico web estándar.
  * **API / Web (Puerto 3000):** Regla de entrada TCP agregada para dar acceso público a la aplicación Node.js.
* **Firewall Local (`ufw`):** Habilitados los puertos 22, 80 y 3000 TCP para comunicación bidireccional.

### Gestión de Procesos en Producción:
* **PM2 Process Manager:** Administra la aplicación Node.js (`entrelazados-backend`) en segundo plano, gestionando reinicios automáticos ante cualquier fallo imprevisto y persistencia en reinicios del servidor mediante `pm2 save`.

---

## 📂 Estructura del Proyecto

```text
Entrelazados_web/
├── backend/
│   ├── package.json
│   ├── package-lock.json
│   └── entrelazados-api/
│       ├── .env                  # Variables de entorno (puerto, BD, API Keys)
│       ├── index.js              # Servidor principal Express + API
│       └── node_modules/
├── frontend/
│   ├── index.html                # Vista principal de la aplicación
│   ├── css/                      # Hojas de estilo
│   └── js/                       # Lógica de cliente e integración de la API
└── README.md                     # Documentación general del proyecto
