/* ==========================================================================
   CAMPANA DE NOTIFICACIONES
   La carga sesion.js en las páginas con sesión. Se coloca sola junto al menú
   del usuario (.user-dropdown-wrapper) aunque la página lo dibuje después.

   - Al abrir la página pide GET /api/notificaciones.
   - Las nuevas llegan al instante por el evento "entrelazados:notificacion:nueva"
     (tiempo real, ver sesion.js): suben al principio de la lista, la campana se
     mueve y aparece un aviso flotante unos segundos.
   - Al hacer clic en una se marca como leída y se va a su página.
   ========================================================================== */
(function () {
    if (window.__campanaEntrelazados) return;
    window.__campanaEntrelazados = true;

    const ICONOS = {
        PujaSuperada: 'ti-trending-up',
        PujaRecibida: 'ti-hammer',
        SubastaGanada: 'ti-trophy',
        SubastaTerminada: 'ti-flag-check',
        SubastaCancelada: 'ti-ban',
        TratoActualizado: 'ti-truck-delivery',
        CalificacionRecibida: 'ti-star',
        AlertaBusqueda: 'ti-bell-ringing',
        FavoritoRebajado: 'ti-heart'
    };
    const esc = window.esc || ((v) => String(v ?? ''));
    const estado = { lista: [], noLeidas: 0, abierto: false, cargado: false };

    // ---------------------------------------------------------------- ESTILOS
    const css = document.createElement('style');
    css.textContent = `
        .campana-ent { position: relative; display: inline-flex; align-items: center; justify-content: center;
            width: 40px; height: 40px; border-radius: 6px; cursor: pointer; flex-shrink: 0;
            background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); color: #fff;
            font-size: 21px; margin-right: 10px; transition: background .2s; }
        .campana-ent:hover, .campana-ent[aria-expanded="true"] { background: rgba(255,255,255,0.2); }
        .campana-ent:focus-visible { outline: 2px solid #ffd27a; outline-offset: 2px; }
        .campana-ent .campana-num { position: absolute; top: -6px; right: -6px; min-width: 19px; height: 19px; padding: 0 5px;
            border-radius: 10px; background: #c92a2a; color: #fff; font: 700 11px/19px 'Segoe UI', Arial, sans-serif;
            text-align: center; box-shadow: 0 0 0 2px var(--color-secundario, #3D170A); }
        .campana-ent.sacudir i { animation: campana-sacudir .7s ease; transform-origin: 50% 10%; }
        @keyframes campana-sacudir { 0%,100% { transform: rotate(0) } 20% { transform: rotate(16deg) } 40% { transform: rotate(-14deg) }
            60% { transform: rotate(9deg) } 80% { transform: rotate(-5deg) } }

        .panel-notif { position: fixed; z-index: 3000; width: min(380px, calc(100vw - 24px)); max-height: min(520px, calc(100vh - 90px));
            display: none; flex-direction: column; background: #fff; color: #2B1A12; border-radius: 10px;
            box-shadow: 0 12px 32px rgba(43,26,18,.25); border: 1px solid #eadfd5; overflow: hidden;
            font-family: 'Segoe UI', Arial, sans-serif; }
        .panel-notif.abierto { display: flex; }
        .panel-notif-cab { display: flex; align-items: center; justify-content: space-between; gap: 8px;
            padding: 12px 14px; border-bottom: 1px solid #f0e6dd; background: #FBF7F2; }
        .panel-notif-cab strong { font-size: 15px; color: #3D170A; }
        .panel-notif-cab button { background: none; border: none; color: #7D381B; font-size: 12.5px; font-weight: 600;
            cursor: pointer; padding: 4px 6px; border-radius: 4px; }
        .panel-notif-cab button:hover { background: #f3e9df; }
        .panel-notif-cab button:disabled { color: #b8a99c; cursor: default; background: none; }
        .panel-notif-lista { overflow-y: auto; list-style: none; margin: 0; padding: 0; }
        .item-notif { display: flex; gap: 11px; padding: 12px 14px; cursor: pointer; text-align: left; width: 100%; background: #fff;
            border: 0; border-bottom: 1px solid #f5eee8; border-left: 3px solid transparent; font: inherit; color: inherit; }
        .item-notif:hover, .item-notif:focus-visible { background: #FBF7F2; outline: none; }
        .item-notif.no-leida { background: #FFF8EC; border-left-color: #C8862A; }
        .item-notif .icono { flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; background: #F5EFE9; color: #7D381B;
            display: flex; align-items: center; justify-content: center; font-size: 18px; }
        .item-notif .texto { min-width: 0; flex: 1; }
        .item-notif .titulo { font-size: 13.5px; font-weight: 600; line-height: 1.3; }
        .item-notif .mensaje { font-size: 12.5px; color: #5c4a3f; margin-top: 2px; line-height: 1.35; }
        .item-notif .cuando { font-size: 11.5px; color: #9a887b; margin-top: 4px; }
        .panel-notif-vacio { padding: 32px 18px; text-align: center; color: #8a786b; font-size: 13.5px; }
        .panel-notif-vacio i { display: block; font-size: 34px; margin-bottom: 8px; color: #c9b6a6; }

        .aviso-notif { position: fixed; z-index: 3100; right: 16px; top: 76px; width: min(340px, calc(100vw - 32px));
            display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 10px; cursor: pointer;
            background: #3D170A; color: #fff; box-shadow: 0 10px 28px rgba(0,0,0,.3); font-family: 'Segoe UI', Arial, sans-serif;
            transform: translateY(-12px); opacity: 0; transition: transform .25s ease, opacity .25s ease; }
        .aviso-notif.visible { transform: none; opacity: 1; }
        .aviso-notif i { font-size: 20px; color: #ffd27a; margin-top: 1px; }
        .aviso-notif .titulo { font-weight: 600; font-size: 13.5px; }
        .aviso-notif .mensaje { font-size: 12.5px; opacity: .85; margin-top: 2px; }
        @media (prefers-reduced-motion: reduce) { .campana-ent.sacudir i { animation: none; } .aviso-notif { transition: none; } }
    `;
    document.head.appendChild(css);

    // ---------------------------------------------------------------- ELEMENTOS
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'campana-ent';
    boton.setAttribute('aria-haspopup', 'true');
    boton.setAttribute('aria-expanded', 'false');
    boton.innerHTML = '<i class="ti ti-bell" aria-hidden="true"></i><span class="campana-num" hidden></span>';

    const panel = document.createElement('div');
    panel.className = 'panel-notif';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notificaciones');
    panel.innerHTML = `
        <div class="panel-notif-cab">
            <strong>Notificaciones</strong>
            <button type="button" class="marcar-todas">Marcar todas como leídas</button>
        </div>
        <ul class="panel-notif-lista"></ul>`;
    document.body.appendChild(panel);

    // Se coloca antes del menú del usuario; si la página lo vuelve a dibujar, se vuelve a colocar
    function colocar() {
        const ancla = document.querySelector('.user-dropdown-wrapper');
        if (!ancla || boton.nextElementSibling === ancla) return;
        ancla.parentNode.insertBefore(boton, ancla);
        // La campana va al lado del menú del usuario (no encima)
        const contenedor = ancla.parentNode;
        if (getComputedStyle(contenedor).display !== 'flex') {
            contenedor.style.display = 'flex';
            contenedor.style.alignItems = 'center';
        }
    }
    colocar();
    new MutationObserver(colocar).observe(document.body, { childList: true, subtree: true });

    // ---------------------------------------------------------------- DIBUJAR
    function hace(fecha) {
        const seg = Math.max(0, (Date.now() - new Date(fecha)) / 1000);
        if (seg < 60) return 'Hace un momento';
        if (seg < 3600) return `Hace ${Math.floor(seg / 60)} min`;
        if (seg < 86400) return `Hace ${Math.floor(seg / 3600)} h`;
        const dias = Math.floor(seg / 86400);
        return dias === 1 ? 'Ayer' : dias < 7 ? `Hace ${dias} días` : new Date(fecha).toLocaleDateString('es-NI');
    }

    function pintarContador() {
        const num = boton.querySelector('.campana-num');
        num.hidden = estado.noLeidas === 0;
        num.textContent = estado.noLeidas > 99 ? '99+' : String(estado.noLeidas);
        boton.title = estado.noLeidas ? `${estado.noLeidas} notificación${estado.noLeidas === 1 ? '' : 'es'} sin leer` : 'Notificaciones';
        boton.setAttribute('aria-label', boton.title);
        panel.querySelector('.marcar-todas').disabled = estado.noLeidas === 0;
    }

    function pintarLista() {
        const ul = panel.querySelector('.panel-notif-lista');
        if (estado.lista.length === 0) {
            ul.innerHTML = `<li class="panel-notif-vacio"><i class="ti ti-bell-off"></i>${estado.cargado ? 'No tienes notificaciones todavía.' : 'Cargando…'}</li>`;
            return;
        }
        ul.innerHTML = estado.lista.map(n => `
            <li><button type="button" class="item-notif ${n.leida ? '' : 'no-leida'}" data-id="${n.id}">
                <span class="icono"><i class="ti ${ICONOS[n.tipo] || 'ti-bell'}"></i></span>
                <span class="texto">
                    <span class="titulo">${esc(n.titulo)}</span>
                    <span class="mensaje" style="display:block">${esc(n.mensaje)}</span>
                    <span class="cuando" style="display:block">${hace(n.fecha)}</span>
                </span>
            </button></li>`).join('');
    }

    function pintar() { pintarContador(); pintarLista(); }

    // ---------------------------------------------------------------- DATOS
    async function cargar() {
        try {
            const res = await fetch('/api/notificaciones');
            if (!res.ok) return;
            const datos = await res.json();
            estado.lista = datos.notificaciones;
            estado.noLeidas = datos.noLeidas;
            estado.cargado = true;
            pintar();
        } catch (e) { /* sin conexión: se intenta al reconectar */ }
    }

    async function abrirNotificacion(id) {
        const n = estado.lista.find(x => x.id === id);
        if (!n) return;
        if (!n.leida) {
            n.leida = true;
            estado.noLeidas = Math.max(0, estado.noLeidas - 1);
            pintar();
            fetch(`/api/notificaciones/${id}/leida`, { method: 'PUT' }).catch(() => { });
        }
        if (n.enlace) {
            const [pagina, ancla] = n.enlace.split('#');
            const actual = window.location.pathname.split('/').pop() || 'preview.html';
            if (pagina === actual) {
                cerrar();
                if (ancla) {
                    // Avisa a la página (p. ej. el Mercado abre la pestaña de subastas) y baja hasta ahí
                    history.replaceState(null, '', '#' + ancla);
                    window.dispatchEvent(new HashChangeEvent('hashchange'));
                    setTimeout(() => { const el = document.getElementById(ancla); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 50);
                }
            } else {
                window.location.href = n.enlace;
            }
        }
    }

    // ---------------------------------------------------------------- ABRIR / CERRAR
    function ubicarPanel() {
        const r = boton.getBoundingClientRect();
        const ancho = panel.offsetWidth;
        panel.style.top = `${r.bottom + 8}px`;
        panel.style.left = `${Math.max(12, Math.min(r.right - ancho, window.innerWidth - ancho - 12))}px`;
    }
    function abrir() {
        estado.abierto = true;
        panel.classList.add('abierto');
        boton.setAttribute('aria-expanded', 'true');
        ubicarPanel();
        cargar();
    }
    function cerrar() {
        estado.abierto = false;
        panel.classList.remove('abierto');
        boton.setAttribute('aria-expanded', 'false');
    }

    boton.addEventListener('click', (e) => { e.stopPropagation(); estado.abierto ? cerrar() : abrir(); });
    panel.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.item-notif');
        if (item) abrirNotificacion(Number(item.dataset.id));
    });
    panel.querySelector('.marcar-todas').addEventListener('click', async () => {
        estado.lista.forEach(n => { n.leida = true; });
        estado.noLeidas = 0;
        pintar();
        fetch('/api/notificaciones/leidas', { method: 'PUT' }).catch(() => { });
    });
    document.addEventListener('click', () => { if (estado.abierto) cerrar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && estado.abierto) { cerrar(); boton.focus(); } });
    window.addEventListener('resize', () => { if (estado.abierto) ubicarPanel(); });

    // ---------------------------------------------------------------- TIEMPO REAL
    let relojAviso = null;
    function mostrarAviso(n) {
        document.querySelectorAll('.aviso-notif').forEach(a => a.remove());
        const aviso = document.createElement('div');
        aviso.className = 'aviso-notif';
        aviso.setAttribute('role', 'status');
        aviso.innerHTML = `<i class="ti ${ICONOS[n.tipo] || 'ti-bell'}"></i>
            <div><div class="titulo">${esc(n.titulo)}</div><div class="mensaje">${esc(n.mensaje)}</div></div>`;
        aviso.addEventListener('click', () => { aviso.remove(); abrirNotificacion(n.id); });
        document.body.appendChild(aviso);
        requestAnimationFrame(() => aviso.classList.add('visible'));
        clearTimeout(relojAviso);
        relojAviso = setTimeout(() => { aviso.classList.remove('visible'); setTimeout(() => aviso.remove(), 300); }, 6000);
    }

    document.addEventListener('entrelazados:notificacion:nueva', (e) => {
        const n = e.detail;
        if (!n || !n.id) return;
        const yaEstaba = estado.lista.find(x => x.id === n.id);
        // Una notificación agrupada (misma subasta) vuelve a subir con el texto nuevo
        estado.lista = [n, ...estado.lista.filter(x => x.id !== n.id)].slice(0, 30);
        if (!yaEstaba || yaEstaba.leida) estado.noLeidas++;
        pintar();
        boton.classList.remove('sacudir');
        void boton.offsetWidth;
        boton.classList.add('sacudir');
        mostrarAviso(n);
    });
    // Al reconectarse pudo haberse perdido algo: se vuelve a pedir la lista
    document.addEventListener('entrelazados:conexion', (e) => { if (e.detail && e.detail.conectado) cargar(); });

    pintar();
    cargar();
})();
