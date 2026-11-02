/* ==========================================================================
   SESIÓN DE ENTRELAZADOS
   Agrega automáticamente el token JWT (guardado al iniciar sesión) a todas
   las peticiones /api del sitio. Si el servidor responde 401 (sesión vencida
   o inválida) se cierra la sesión y se vuelve a login.html.
   Debe cargarse en el <head>, antes de los demás scripts de la página.
   ========================================================================== */
(function () {
    const fetchOriginal = window.fetch.bind(window);
    const PAGINAS_PUBLICAS = ['login.html', 'unirse.html', 'preview.html', 'restablecer.html'];

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
})();
