/* ==========================================================================
   SESIÓN DE ENTRELAZADOS
   Agrega automáticamente el token JWT (guardado al iniciar sesión) a todas
   las peticiones /api del sitio. Si el servidor responde 401 (sesión vencida
   o inválida) se cierra la sesión y se vuelve a login.html.
   También muestra el número de mensajes sin leer junto a los enlaces al chat
   (se revisa cada 30 segundos mientras la pestaña está visible).
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

    window.cerrarSesionEntrelazados = function (mensaje) {
        try { localStorage.clear(); } catch (e) { }
        if (mensaje) alert(mensaje);
        window.location.href = 'login.html';
    };

    window.fetch = async function (recurso, opciones) {
        const url = typeof recurso === 'string' ? recurso : (recurso && recurso.url) || '';
        if (!esApiPropia(url)) return fetchOriginal(recurso, opciones);

        let token = null;
        try { token = localStorage.getItem('token'); } catch (e) { }

        const opts = Object.assign({}, opciones);
        const headers = new Headers(opts.headers || (recurso instanceof Request ? recurso.headers : undefined));
        if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
        opts.headers = headers;

        const res = await fetchOriginal(recurso, opts);

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
        let token = null;
        try { token = localStorage.getItem('token'); } catch (e) { }
        if (!token || document.hidden) return;
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

    document.addEventListener('DOMContentLoaded', () => {
        const pagina = window.location.pathname.split('/').pop() || 'preview.html';
        if (PAGINAS_PUBLICAS.includes(pagina)) return;
        actualizarNoLeidos();
        setInterval(actualizarNoLeidos, INTERVALO_NO_LEIDOS_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) actualizarNoLeidos(); });
    });
})();
