/* ==========================================================================
   SESIÓN DE ENTRELAZADOS
   La sesión vive en la cookie httpOnly "sesion" que pone POST /api/login: el
   navegador la manda sola en cada petición /api y esta página no puede leerla.
   Aquí solo se guardan los datos que no son secretos (userId, userRol, userNombre,
   sesionVence...). Si el servidor responde 401 (sesión vencida o inválida) se
   cierra la sesión y se vuelve a login.html.
   También muestra el número de mensajes sin leer junto a los enlaces al chat
   (se revisa cada 30 segundos mientras la pestaña está visible, y al instante
   cuando llega un mensaje por tiempo real).
   TIEMPO REAL: en las páginas con sesión se conecta a Socket.IO y reenvía cada
   aviso del servidor como evento del documento: "entrelazados:puja:nueva",
   "entrelazados:subastas:cambio", "entrelazados:chat:mensaje" y
   "entrelazados:notificacion:nueva". También carga la campana (notificaciones.js).
   Al final están las ayudas que usan todas las páginas: esc(), cerrarSesion()
   y el menú desplegable del usuario.
   Debe cargarse en el <head>, antes de los demás scripts de la página.
   ========================================================================== */
(function () {
    const fetchOriginal = window.fetch.bind(window);
    const PAGINAS_PUBLICAS = ['login.html', 'unirse.html', 'preview.html', 'restablecer.html', 'verificar.html'];

    function esApiPropia(url) {
        try {
            const u = new URL(url, window.location.origin);
            return u.origin === window.location.origin && u.pathname.startsWith('/api/');
        } catch (e) {
            return false;
        }
    }

    // ¿Hay sesión abierta en este navegador? (la cookie no se puede leer: se mira el userId)
    function haySesion() {
        try { return !!localStorage.getItem('userId'); } catch (e) { return false; }
    }
    window.haySesionEntrelazados = haySesion;

    // Las sesiones anteriores a la cookie guardaban el token aquí: se borra
    try { localStorage.removeItem('token'); } catch (e) { }

    // Cierra la sesión en el servidor (borra la cookie). keepalive: sigue aunque la página cambie
    function cerrarEnServidor() {
        try { return fetchOriginal('/api/logout', { method: 'POST', keepalive: true }).catch(() => { }); }
        catch (e) { return Promise.resolve(); }
    }

    // Borra la sesión guardada, pero conserva el modo claro/oscuro elegido (tema.js)
    function borrarSesionGuardada() {
        try {
            const tema = localStorage.getItem('entrelazados-tema');
            localStorage.clear();
            if (tema) localStorage.setItem('entrelazados-tema', tema);
        } catch (e) { }
    }

    window.cerrarSesionEntrelazados = function (mensaje) {
        cerrarEnServidor();
        borrarSesionGuardada();
        if (mensaje) alert(mensaje);
        window.location.href = 'login.html';
    };

    window.fetch = async function (recurso, opciones) {
        const url = typeof recurso === 'string' ? recurso : (recurso && recurso.url) || '';
        if (!esApiPropia(url)) return fetchOriginal(recurso, opciones);

        // La cookie de sesión va sola (mismo sitio)
        const res = await fetchOriginal(recurso, opciones);

        const pagina = window.location.pathname.split('/').pop() || 'preview.html';
        const pidioLogin = new URL(url, window.location.origin).pathname === '/api/login';
        if (res.status === 401 && !pidioLogin && !PAGINAS_PUBLICAS.includes(pagina)) {
            window.cerrarSesionEntrelazados('Tu sesión expiró. Por favor inicia sesión nuevamente.');
        }
        return res;
    };

    // ---------------------------------------------------------------- MENSAJES NO LEÍDOS
    // Cada enlace a chat.html (menos los del pie de página) lleva un globito con el total.
    // La página del chat escucha el evento "entrelazados:no-leidos" para marcar cada contacto.
    const INTERVALO_NO_LEIDOS_MS = 30000;

    function ponerGlobito(enlace, total) {
        let globo = enlace.querySelector('.globo-no-leidos');
        if (!total) { if (globo) globo.remove(); return; }
        if (!globo) {
            globo = document.createElement('span');
            globo.className = 'globo-no-leidos';
            globo.style.cssText = 'display:inline-block;min-width:18px;padding:0 5px;margin-left:5px;border-radius:9px;' +
                'background:#c92a2a;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center;vertical-align:middle;';
            enlace.appendChild(globo);
        }
        globo.textContent = total > 99 ? '99+' : String(total);
        globo.title = `${total} mensaje${total === 1 ? '' : 's'} sin leer`;
    }

    async function actualizarNoLeidos() {
        if (!haySesion() || document.hidden) return;
        try {
            const res = await window.fetch('/api/chat/no-leidos');
            if (!res.ok) return;
            const datos = await res.json();
            document.querySelectorAll('a[href^="chat.html"]').forEach(enlace => {
                if (!enlace.closest('footer')) ponerGlobito(enlace, datos.total);
            });
            document.dispatchEvent(new CustomEvent('entrelazados:no-leidos', { detail: datos }));
        } catch (e) { /* sin conexión: se intenta en la siguiente vuelta */ }
    }
    window.actualizarNoLeidosEntrelazados = actualizarNoLeidos;

    // ---------------------------------------------------------------- TIEMPO REAL (Ably)
    // window.tiempoRealEntrelazados.conectado dice si los avisos llegan solos; si no,
    // las páginas siguen preguntando cada cierto tiempo como antes.
    // La API firma un permiso de solo lectura (/api/tiempo-real/token) para el canal
    // público y el canal propio. Cada evento se reenvía como "entrelazados:<evento>".
    const EVENTOS_TIEMPO_REAL = ['puja:nueva', 'subastas:cambio', 'chat:mensaje', 'notificacion:nueva'];
    const SDK_ABLY = 'https://unpkg.com/@ably/pubsub-device@3.0.0/dist/cdn/ably.min.js';   // define window.AblyPubSub
    const tiempoReal = window.tiempoRealEntrelazados = { conectado: false, cliente: null };
    const avisar = (nombre, detalle) => document.dispatchEvent(new CustomEvent('entrelazados:' + nombre, { detail: detalle }));

    function cargarScript(src) {
        return new Promise((listo, falla) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = listo;
            s.onerror = falla;
            document.head.appendChild(s);
        });
    }

    // Pide a la API el permiso de Ably (y los nombres de los canales). null si no se puede:
    // sin tiempo real configurado (503), token vencido o cuenta suspendida (401/403).
    async function pedirPermiso() {
        try {
            const res = await window.fetch('/api/tiempo-real/token');
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    }

    async function conectarTiempoReal() {
        const permiso = await pedirPermiso();
        if (!permiso) return;   // la página funciona igual, preguntando cada cierto tiempo
        try {
            if (!window.AblyPubSub) await cargarScript(SDK_ABLY);
        } catch (e) { return; }
        let primero = permiso.tokenRequest;
        const cliente = window.AblyPubSub.createClient({
            // El permiso dura 1 hora; el SDK pide otro solo. Si la sesión ya no sirve, se deja de insistir.
            authCallback: async (_params, listo) => {
                if (primero) { listo(null, primero); primero = null; return; }
                const nuevo = await pedirPermiso();
                if (nuevo) listo(null, nuevo.tokenRequest);
                else { listo('sesion-invalida', null); cliente.close(); }
            },
        });
        tiempoReal.cliente = cliente;
        cliente.connection.on('connected', () => { tiempoReal.conectado = true; avisar('conexion', { conectado: true }); });
        cliente.connection.on(['disconnected', 'suspended', 'closed', 'failed'], () => {
            if (!tiempoReal.conectado) return;
            tiempoReal.conectado = false;
            avisar('conexion', { conectado: false });
        });
        const reenviar = (mensaje) => {
            if (!EVENTOS_TIEMPO_REAL.includes(mensaje.name)) return;
            avisar(mensaje.name, mensaje.data);
            if (mensaje.name === 'chat:mensaje') actualizarNoLeidos();
        };
        cliente.channels.get(permiso.canales.publico).subscribe(reenviar);
        if (permiso.canales.usuario) cliente.channels.get(permiso.canales.usuario).subscribe(reenviar);
    }

    document.addEventListener('DOMContentLoaded', () => {
        const pagina = window.location.pathname.split('/').pop() || 'preview.html';
        if (PAGINAS_PUBLICAS.includes(pagina)) return;
        actualizarNoLeidos();
        setInterval(actualizarNoLeidos, INTERVALO_NO_LEIDOS_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) actualizarNoLeidos(); });

        if (!haySesion()) return;
        conectarTiempoReal();
        cargarScript('notificaciones.js').catch(() => { });
    });

    // ------------------------------------------------------------------
    // AYUDAS COMPARTIDAS POR TODAS LAS PÁGINAS
    // ------------------------------------------------------------------

    // Escapa un texto antes de meterlo en innerHTML (evita XSS):
    //   div.innerHTML = '<p>' + esc(mensaje.ContenidoTexto) + '</p>';
    window.esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    // Botón "Cerrar sesión" de los menús. En la portada solo se recarga; en las demás, al login.
    window.cerrarSesion = async function () {
        await cerrarEnServidor();
        borrarSesionGuardada();
        const pagina = window.location.pathname.split('/').pop() || 'preview.html';
        if (pagina === 'preview.html') window.location.reload();
        else window.location.href = 'login.html';
    };

    // Menú desplegable del usuario en la cabecera (#userDropdownMenu)
    window.toggleUserDropdown = function (event) {
        if (event) event.stopPropagation();
        const menu = document.getElementById('userDropdownMenu');
        if (menu) menu.classList.toggle('show');
    };
    // Se cierra al hacer clic en cualquier otra parte de la página
    document.addEventListener('click', (event) => {
        if (event.target.closest('.user-dropdown-wrapper')) return;
        const menu = document.getElementById('userDropdownMenu');
        if (menu) menu.classList.remove('show');
    });
})();
