# EntreLazados

**EntreLazados** es una plataforma web e industrial diseñada para conectar a **Proveedores** de materiales y residuos reciclables con **Emprendedores** que buscan darles una segunda vida útil a través del supra-reciclaje. 

El sistema optimiza el mercado permitiendo publicaciones tradicionales, subastas interactivas en tiempo real basadas en la cercanía geográfica y comunicación directa mediante mensajería integrada.

---

## Funcionalidades Principales

### Perfil Proveedor
* **Publicación Sincronizada:** Al crear una oferta de material, el sistema genera automáticamente un lote de subasta activa iniciando con el mismo precio base.
* **Eliminación en Cascada:** Al remover una oferta, el backend limpia de forma segura las pujas y subastas asociadas para evitar inconsistencias en la base de datos.
* **Gestión de Inventario:** Control total sobre el mercado y los materiales ofertados.

### Perfil Emprendedor
* **Mercado Geolocalizado:** Filtro avanzado de materiales basado en un control deslizante por rango de distancia en kilómetros (Km).
* **Sistema de Subastas:** Participación activa mediante pujas incrementales sobre lotes verificados en tiempo real.
* **Chat Directo:** Comunicación instantánea incorporada para negociar los detalles de entrega con los proveedores.

---

## Tecnologías Utilizadas

* **Frontend:** HTML5, CSS3 (Diseño responsivo y estético), JavaScript Moderno (Fetch API).
* **Backend:** Node.js, Express.js.
* **Base de Datos:** MySQL (Gestión relacional con transacciones seguras de integridad).
* **Protocolo de Comunicación:** CORS, JSON.

---

## Arquitectura de la Base de Datos

La persistencia de los datos en **EntreLazadosDB** se gestiona mediante el motor `InnoDB` utilizando las siguientes entidades clave:

* `Usuarios`: Almacena las credenciales y define el rol del usuario (`Proveedor` / `Emprendedor`).
* `Departamentos`: Ubicación geográfica para calcular rutas y disponibilidad regional.
* `Ofertas`: Catálogo de materiales publicados con precio por unidad de medida.
* `Subastas`: Lotes activos vinculados directamente a una oferta con control de `PrecioBase` y `PrecioActual`.
* `Pujas`: Historial de ofertas económicas realizadas por los emprendedores.
* `MensajesChat`: Registro de comunicaciones directas e interacciones bilaterales.

---

## Instalación y Configuración

Sigue estos pasos para levantar el proyecto en tu entorno local:

### 1. Clonar el repositorio e instalar dependencias
```bash
# Instalar los módulos necesarios de Node.js
npm install express mysql2 cors
