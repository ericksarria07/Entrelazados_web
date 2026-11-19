// Saludo y preguntas rápidas de Kan por página y por rol (antes en public/kan.js).
// Sus respuestas están aquí mismo: no gastan IA.
// Cada opción: [texto del botón, pregunta en el chat, respuesta]
export type Opcion = [string, string, string];
export type Contenido = { saludo: string; chips?: boolean; opciones: Opcion[] };
export type ContenidoPorRol = { proveedor: Contenido; emprendedor: Contenido };
export type ContextoKan = "inicio" | "mercado" | "dashboard" | "administrador";

export const CONTENIDO: Record<string, Contenido | ContenidoPorRol> = {
    inicio: {
        proveedor: {
            saludo: '¡Hola! 👋 Soy **Kan**. ¿Necesitas ayuda para publicar tus materiales o conectar con talleres de calzado?',
            opciones: [
                ['📦 ¿Cómo publicar insumos?', '¿Cómo puedo publicar mis insumos?',
                    'Puedes ingresar al **Dashboard** desde el menú principal. Ahí encontrarás el formulario para publicar tus lotes de materia prima, establecer el precio por unidad y generar automáticamente subastas, o también puedes hacerlo en el apartado de **Mercado**.'],
                ['💬 Chatear con compradores', '¿Cómo me contactan los compradores?',
                    'Los artesanos y calzaderistas te escribirán a través del apartado de **Chat** de la plataforma. Recibirás una notificación cuando te envíen un mensaje interesándose por tus insumos.'],
                ['📍 Radio de envíos', '¿Cómo funciona el radio de envíos?',
                    'El sistema calcula automáticamente la ubicación de tu negocio y le muestra a los compradores la distancia aproximada en kilómetros para que sepan la proximidad de la entrega.']
            ]
        },
        emprendedor: {
            saludo: '¡Hola! 👋 Soy **Kan**, tu guía en EntreLazados. ¿En qué te puedo ayudar hoy con la materia prima?',
            opciones: [
                ['🔍 Buscar materia prima', '¿Cómo busco materia prima?',
                    "Para buscar materia prima, ve a la pestaña **'Mercado Completo'** en la barra superior. Puedes filtrar por categorías como cuero vacuno, suelas, herrajes o usar la barra de búsqueda principal por nombre."],
                ['🏭 Contactar proveedores', '¿Cómo me contacto con proveedores?',
                    'En el perfil de cada oferta verás la opción de iniciar un **Chat directo** dentro de EntreLazados o comunicarte al número de WhatsApp registrado por la curtiembre o proveedor.'],
                ['📍 Insumos cerca de mí', '¿Cómo encuentro insumos cerca de mi taller?',
                    "Usa el control deslizante de **'Radio de Cercanía'** que está en la barra superior debajo del encabezado. Puedes ajustar el rango desde 5 km hasta 200 km respecto a tu departamento."]
            ]
        }
    },

    mercado: {
        proveedor: {
            saludo: '¡Hola! 👋 Soy **Kan**. Te ayudo a gestionar ofertas, publicar subastas o administrar contenidos en el Mercado.',
            chips: true,
            opciones: [
                ['➕ ¿Cómo publicar una oferta?', '¿Cómo publico un nuevo material?',
                    'Haz clic en el botón **+ Publicar Oferta** arriba a la derecha. Completa el título, precio, categoría y sube fotos de tus materiales.'],
                ['🔨 ¿Cómo crear una subasta?', '¿Cómo puedo iniciar una subasta?',
                    'Selecciona la pestaña **Subastas Activas** y haz clic en **+ Crear Subasta** para ofrecer lotes al mejor postor.'],
                ['📍 Distancia de envíos', '¿Cómo se calcula el radio de distancia?',
                    'Los compradores filtran insumos usando el deslizable de kilómetros. Asegúrate de tener tu departamento actualizado en tu **Perfil**.']
            ]
        },
        emprendedor: {
            saludo: '¡Hola! 👋 Soy **Kan**. ¿Quieres ayuda para encontrar ofertas, pujar en subastas o ubicar proveedores en el mapa?',
            chips: true,
            opciones: [
                ['🛍️ ¿Cómo comprar insumos?', '¿Cómo compro o contacto por ofertas directas?',
                    'En la pestaña **Ofertas Directas** verás los productos. Haz clic en el botón **Contactar Proveedor** para iniciar una conversación privada.'],
                ['🔨 ¿Cómo pujar en subastas?', '¿Cómo puedo participar en una subasta?',
                    'Ingresa a la pestaña **Subastas Activas**, escribe un monto superior al precio actual y presiona **Pujar**.'],
                ['🗺 Ver mapa de proveedores', '¿Cómo funciona el mapa de proveedores?',
                    'Ve a la pestaña **Mapa de Proveedores** para visualizar la ubicación geográfica y especialidades de las curtiembres y talleres en Nicaragua.']
            ]
        }
    },

    dashboard: {
        proveedor: {
            saludo: '¡Hola! 👋 Soy **Kan**. ¿Qué deseas consultar sobre tus publicaciones?',
            opciones: [
                ['📦 ¿Cómo se generan las subastas al publicar un insumo?', '¿Cómo se generan las subastas al publicar un insumo?',
                    'Cada vez que publicas un nuevo material desde tu formulario en el dashboard, el sistema de EntreLazados crea automáticamente un lote en la sección de Subastas utilizando el precio base que estableciste.'],
                ['🗑️ ¿Cómo edito o elimino un material que ya se agotó?', '¿Cómo edito o elimino un material que ya se agotó?',
                    'En el **Mercado**, cada publicación tuya tiene los botones **Editar** y **Eliminar**. Con Editar cambias el título, el precio, la categoría o las fotos; con Eliminar retiras el material de inmediato (si su subasta ya tiene pujas, tendrás que esperar a que cierre).'],
                ['💬 ¿Cómo sé qué talleres están interesados en mi materia prima?', '¿Cómo sé qué talleres están interesados en mi materia prima?',
                    'Puedes revisar el apartado de Chat en la barra de navegación superior. Ahí recibirás de forma directa los mensajes y consultas de los emprendedores.']
            ]
        },
        emprendedor: {
            saludo: '¡Hola! 👋 Soy **Kan**, tu guía en EntreLazados. ¿En qué te puedo ayudar hoy?',
            opciones: [
                ['🔨 ¿Cómo funcionan las pujas en las subastas de lotes?', '¿Cómo funcionan las pujas en las subastas de lotes?',
                    'En la sección de Subastas verás los lotes activos publicados por los proveedores. Puedes ingresar una oferta económica superior a la puja actual en córdobas (C$) para competir por el lote.'],
                ['📍 ¿Cómo se calcula la distancia y los costos de envío?', '¿Cómo se calcula la distancia y los costos de envío?',
                    'EntreLazados toma tu departamento registrado y calcula una distancia simulada en kilómetros respecto a la ubicación del proveedor.'],
                ['📞 ¿Cómo puedo contactar directo al proveedor si necesito un pedido especial?', '¿Cómo puedo contactar directo al proveedor si necesito un pedido especial?',
                    'En el perfil de cualquier oferta publicada encontrarás acceso directo al Chat de la plataforma para coordinar entregas personalizadas.']
            ]
        }
    },

    // El administrador ve estas preguntas en cualquier página
    administrador: {
        saludo: '¡Hola, Administrador! 🛡️ Soy **Kan**. ¿Qué herramientas de moderación o gestión deseas consultar?',
        opciones: [
            ['📊 Ver reporte rápido', '¿Dónde veo el reporte rápido de la plataforma?',
                'En el **Panel Admin**, la parte superior tiene el resumen general: usuarios, proveedores, materiales activos y las cuentas con problemas de correo.'],
            ['🛡️ ¿Cómo moderar un lote?', '¿Cómo elimino o modero publicaciones inapropiadas?',
                "En las tablas del **Panel Admin** puedes usar 'Cambiar estado' para suspender cuentas o 'Eliminar' para retirar cualquier publicación. En el Mercado también verás el botón **Admin: Eliminar** en cada oferta. Si tenía pujas, Kan avisa a quienes pujaron."],
            ['📦 ¿Cómo funcionan las subastas?', '¿Cómo funcionan las subastas en el sistema?',
                'Cada publicación abre un lote en subasta por 7 días con su precio base. Al vencer, el sistema la cierra solo: gana la puja más alta, se crea el trato y se abre el chat entre las dos partes.']
        ]
    }
};
export function contenidoKan(contexto: ContextoKan, rol: string): Contenido {
  const r = (rol || "").toLowerCase().trim();
  if (r === "administrador" || r === "admin") return CONTENIDO.administrador as Contenido;
  const pagina = (CONTENIDO[contexto] || CONTENIDO.inicio) as ContenidoPorRol;
  return r === "proveedor" ? pagina.proveedor : pagina.emprendedor;
}
