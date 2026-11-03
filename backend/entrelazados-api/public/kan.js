/* ==========================================================================
   KAN, EL ASISTENTE FLOTANTE (componente compartido)

   Uso en una página (después de sesion.js):
     <link rel="stylesheet" href="kan.css">
     <script src="kan.js" data-contexto="mercado" defer></script>

   El componente agrega solo su botón y su ventana al final de la página.
   - Las preguntas rápidas cambian según la página (data-contexto) y el rol
     de quien inició sesión; sus respuestas están aquí mismo (no gastan IA).
   - Lo que el usuario escribe a mano se envía a POST /api/chat/ia (Gemini).
   - Todo texto se muestra escapado: **texto** se convierte en negrita.
   ========================================================================== */
(function () {
    'use strict';

    const POSES = {
        saludando: 'randal-saludando.webp',
        telefono: 'randal-telefono.webp',
        dudando: 'randal-dudando.webp',
        respondiendo: 'randal-principal.webp',
        durmiendo: 'randal-durmiendo.webp'
    };
    const MINUTOS_PARA_DORMIR = 2;
    const SEGUIMIENTO = '¿Tienes alguna otra pregunta o duda?';

    // ---------------------------------------------------------------------
    // CONTENIDO: saludo y preguntas rápidas por página y por rol.
    // Cada opción: [pregunta que se muestra en el botón, pregunta en el chat, respuesta]
    // ---------------------------------------------------------------------
    const CONTENIDO = {
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

    // ---------------------------------------------------------------------
    const script = document.currentScript;
    const contexto = (script && script.dataset.contexto) || 'inicio';
    let temporizadorSueno = null;
    let el = {};   // referencias a los elementos del componente

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Escapa el texto y convierte **así** en negrita (lo único que se permite como formato)
    const formato = (texto) => esc(texto).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    function contenidoActual() {
        const rol = (localStorage.getItem('userRol') || '').toLowerCase().trim();
        if (rol === 'administrador' || rol === 'admin') return CONTENIDO.administrador;
        const pagina = CONTENIDO[contexto] || CONTENIDO.inicio;
        return rol === 'proveedor' ? pagina.proveedor : pagina.emprendedor;
    }

    function crearElementos() {
        const contenedor = document.createElement('div');
        contenedor.className = 'kan-componente';
        contenedor.innerHTML = `
            <button type="button" class="kan-widget-btn" aria-label="Abrir el chat de Kan">
                <img src="${POSES.saludando}" alt="Kan, el asistente">
                <span class="kan-badge">1</span>
            </button>
            <div class="kan-chat-window" role="dialog" aria-label="Chat con Kan">
                <div class="kan-header">
                    <div class="kan-header-info">
                        <div class="kan-avatar-header"><img src="${POSES.saludando}" alt=""></div>
                        <div>
                            <div class="kan-title">Kan <span>(Asistente)</span></div>
                            <div class="kan-sub">🟢 En línea</div>
                        </div>
                    </div>
                    <button type="button" class="kan-close-btn" aria-label="Cerrar">✕</button>
                </div>
                <div class="kan-display-banner"><img src="${POSES.saludando}" alt=""></div>
                <div class="kan-body">
                    <div class="kan-msg bot"></div>
                    <div class="kan-quick-options"></div>
                </div>
                <div class="kan-footer">
                    <input type="text" class="kan-input" placeholder="Pregúntale algo a Kan..." maxlength="1000">
                    <button type="button" class="kan-send-btn" aria-label="Enviar"><i class="ti ti-send"></i></button>
                </div>
            </div>`;
        document.body.appendChild(contenedor);

        el = {
            boton: contenedor.querySelector('.kan-widget-btn'),
            imgBoton: contenedor.querySelector('.kan-widget-btn img'),
            insignia: contenedor.querySelector('.kan-badge'),
            ventana: contenedor.querySelector('.kan-chat-window'),
            banner: contenedor.querySelector('.kan-display-banner img'),
            cuerpo: contenedor.querySelector('.kan-body'),
            saludo: contenedor.querySelector('.kan-msg.bot'),
            opciones: contenedor.querySelector('.kan-quick-options'),
            entrada: contenedor.querySelector('.kan-input')
        };

        el.boton.addEventListener('click', alternar);
        contenedor.querySelector('.kan-close-btn').addEventListener('click', alternar);
        contenedor.querySelector('.kan-send-btn').addEventListener('click', enviarEscrito);
        el.entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarEscrito(); });
        el.opciones.addEventListener('click', (e) => {
            const boton = e.target.closest('.kan-opt-btn');
            if (boton) responderOpcion(Number(boton.dataset.indice));
        });
    }

    function cargarMenu() {
        const c = contenidoActual();
        el.saludo.innerHTML = formato(c.saludo);
        el.opciones.classList.toggle('chips', !!c.chips);
        el.opciones.innerHTML = c.opciones
            .map(([boton], i) => `<button type="button" class="kan-opt-btn" data-indice="${i}">${esc(boton)}</button>`)
            .join('');
    }

    function cambiarPose(pose) {
        const src = POSES[pose] || POSES.saludando;
        el.banner.style.opacity = '0';
        setTimeout(() => {
            el.banner.src = src;
            el.banner.style.opacity = '1';
        }, 150);
        if (!el.ventana.classList.contains('active')) el.imgBoton.src = src;
    }

    // Si nadie habla con Kan por un rato, se queda dormido en su botón
    function reiniciarSueno() {
        clearTimeout(temporizadorSueno);
        el.imgBoton.src = POSES.saludando;
        temporizadorSueno = setTimeout(() => {
            if (!el.ventana.classList.contains('active')) el.imgBoton.src = POSES.durmiendo;
        }, MINUTOS_PARA_DORMIR * 60 * 1000);
    }

    function agregarMensaje(texto, quien) {
        const div = document.createElement('div');
        div.className = `kan-msg ${quien}`;
        div.innerHTML = formato(texto);
        el.cuerpo.appendChild(div);
        el.cuerpo.scrollTop = el.cuerpo.scrollHeight;
    }

    function alternar() {
        const abierta = el.ventana.classList.toggle('active');
        el.insignia.style.display = 'none';
        if (abierta) {
            cargarMenu();
            el.entrada.focus();
        }
        cambiarPose('saludando');
        reiniciarSueno();
    }

    // Pregunta rápida: respuesta local, sin gastar la IA
    function responderOpcion(indice) {
        const opcion = contenidoActual().opciones[indice];
        if (!opcion) return;
        const [, pregunta, respuesta] = opcion;
        reiniciarSueno();
        agregarMensaje(pregunta, 'user');
        cambiarPose('telefono');
        setTimeout(() => {
            cambiarPose('respondiendo');
            agregarMensaje(respuesta, 'bot');
            setTimeout(() => {
                cambiarPose('dudando');
                agregarMensaje(SEGUIMIENTO, 'bot');
            }, 3000);
        }, 700);
    }

    // Texto libre: se lo pregunta a la IA (POST /api/chat/ia, con la sesión de sesion.js)
    async function enviarEscrito() {
        const texto = el.entrada.value.trim();
        if (!texto) return;
        el.entrada.value = '';
        reiniciarSueno();
        agregarMensaje(texto, 'user');
        cambiarPose('telefono');
        try {
            const res = await fetch('/api/chat/ia', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensajeUsuario: texto })
            });
            const data = await res.json();
            cambiarPose('respondiendo');
            agregarMensaje(data.respuesta || data.error || data.message || 'No pude responder en este momento.', 'bot');
            setTimeout(() => cambiarPose('dudando'), 3000);
        } catch (error) {
            console.error('Error al conectar con Kan:', error);
            cambiarPose('respondiendo');
            agregarMensaje('Lo siento, no pude procesar tu solicitud en este momento. Por favor inténtalo de nuevo.', 'bot');
        }
    }

    function iniciar() {
        crearElementos();
        cargarMenu();
        reiniciarSueno();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();

    // Para abrir a Kan desde otro botón de la página: onclick="abrirKan()"
    window.abrirKan = () => { if (!el.ventana.classList.contains('active')) alternar(); };
})();
