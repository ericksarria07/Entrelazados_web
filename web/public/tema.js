/* ==========================================================================
   MODO OSCURO Y ACCESIBILIDAD (todas las páginas)

   Se carga en el <head> de cada página, lo antes posible, para que la página
   no "parpadee" en claro antes de pasar a oscuro.

   MODO OSCURO
   - La primera vez se usa el modo del sistema (Windows, Android, iPhone...).
   - El botón redondo de abajo a la izquierda cambia entre claro y oscuro, y
     la elección se guarda en este navegador (localStorage "entrelazados-tema").
   - Pone <html data-tema="oscuro"> o "claro"; los colores están en tema.css,
     que se agrega al final del <head> para que gane a los estilos de cada página.

   ACCESIBILIDAD
   - Enlace "Saltar al contenido" (aparece al navegar con Tab).
   - Los íconos decorativos (<i class="ti ...">) quedan ocultos para los
     lectores de pantalla, y los botones que solo tienen un ícono toman su
     nombre del title. Se revisa también lo que las páginas agregan después.
   - Las imágenes sin alt quedan como decorativas (alt="").
   ========================================================================== */
(function () {
    const CLAVE = 'entrelazados-tema';
    const raiz = document.documentElement;
    const sistemaOscuro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function guardado() {
        try {
            const t = localStorage.getItem(CLAVE);
            return t === 'claro' || t === 'oscuro' ? t : null;
        } catch (e) { return null; }
    }

    const temaActual = () => guardado() || (sistemaOscuro && sistemaOscuro.matches ? 'oscuro' : 'claro');

    function aplicar(tema) {
        raiz.setAttribute('data-tema', tema);
        raiz.style.colorScheme = tema === 'oscuro' ? 'dark' : 'light';
        const boton = document.querySelector('.tema-boton');
        if (boton) {
            const oscuro = tema === 'oscuro';
            boton.setAttribute('aria-pressed', String(oscuro));
            boton.setAttribute('aria-label', oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
            boton.title = boton.getAttribute('aria-label');
            boton.innerHTML = `<i class="ti ${oscuro ? 'ti-sun' : 'ti-moon'}" aria-hidden="true"></i>`;
        }
    }

    // 1. Lo antes posible: el atributo y la hoja de estilos
    aplicar(temaActual());
    const hoja = document.createElement('link');
    hoja.rel = 'stylesheet';
    hoja.href = 'tema.css';
    document.head.appendChild(hoja);

    window.temaEntrelazados = {
        actual: temaActual,
        cambiar(tema) {
            try { localStorage.setItem(CLAVE, tema); } catch (e) { }
            aplicar(tema);
        },
        alternar() {
            this.cambiar(temaActual() === 'oscuro' ? 'claro' : 'oscuro');
            // Las gráficas (Chart.js) toman sus colores al dibujarse: esas páginas se recargan
            if (document.querySelector('canvas') && window.Chart) window.location.reload();
        }
    };

    // Si la persona no eligió nada, se sigue el modo del sistema cuando este cambia
    if (sistemaOscuro && sistemaOscuro.addEventListener) {
        sistemaOscuro.addEventListener('change', () => { if (!guardado()) aplicar(temaActual()); });
    }
    // Al imprimir o guardar como PDF siempre se usa el modo claro (papel blanco).
    // (reportes.html además vuelve a dibujar sus gráficas en claro antes de imprimir)
    let temaAntesDeImprimir = null;
    window.addEventListener('beforeprint', () => {
        if (raiz.getAttribute('data-tema') !== 'oscuro') return;
        temaAntesDeImprimir = 'oscuro';
        raiz.setAttribute('data-tema', 'claro');
    });
    window.addEventListener('afterprint', () => {
        if (temaAntesDeImprimir) raiz.setAttribute('data-tema', temaAntesDeImprimir);
        temaAntesDeImprimir = null;
    });

    // Otra pestaña cambió el tema: se aplica aquí también
    window.addEventListener('storage', (e) => { if (e.key === CLAVE) aplicar(temaActual()); });

    // ---------------------------------------------------------------- ACCESIBILIDAD
    function mejorarAccesibilidad(base) {
        if (!base || !base.querySelectorAll) return;
        base.querySelectorAll('i.ti:not([aria-hidden])').forEach(i => i.setAttribute('aria-hidden', 'true'));
        base.querySelectorAll('img:not([alt])').forEach(img => img.setAttribute('alt', ''));
        base.querySelectorAll('button:not([aria-label]), a:not([aria-label])').forEach(el => {
            if (el.textContent.trim() === '' && el.title) el.setAttribute('aria-label', el.title);
        });
    }

    // El contenido principal: <main>, o el contenedor más común de cada página
    function contenidoPrincipal() {
        return document.querySelector('main, [role="main"], #app, .main-content, .contenedor, .container, .hoja');
    }

    document.addEventListener('DOMContentLoaded', () => {
        // tema.css al final del <head>: así gana a los <style> propios de la página
        document.head.appendChild(hoja);

        // Botón de modo oscuro
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'tema-boton';
        boton.addEventListener('click', () => window.temaEntrelazados.alternar());
        document.body.appendChild(boton);
        aplicar(temaActual());

        // Enlace "Saltar al contenido"
        const principal = contenidoPrincipal();
        if (principal) {
            if (!principal.id) principal.id = 'contenido-principal';
            if (!principal.hasAttribute('tabindex')) principal.setAttribute('tabindex', '-1');
            const saltar = document.createElement('a');
            saltar.className = 'saltar-contenido';
            saltar.href = '#' + principal.id;
            saltar.textContent = 'Saltar al contenido';
            document.body.insertBefore(saltar, document.body.firstChild);
        }

        mejorarAccesibilidad(document.body);
        // Las páginas pintan listas con innerHTML: se revisa lo nuevo (agrupado, sin trabajo extra)
        let pendiente = false;
        new MutationObserver(() => {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(() => { pendiente = false; mejorarAccesibilidad(document.body); });
        }).observe(document.body, { childList: true, subtree: true });
    });
})();
