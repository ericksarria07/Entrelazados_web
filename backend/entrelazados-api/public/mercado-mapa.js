/* ==========================================================================
   MERCADO: mapa de proveedores (mercado.html)
   Un círculo por departamento con sus proveedores (Leaflet). Usa el estado de
   mercado.js (mapa, capaMapa) y respeta la categoría elegida en el buscador.
   ========================================================================== */
// ------------------------------------------------------------ MAPA DE PROVEEDORES
// Un círculo por departamento (crece con la cantidad de proveedores), con la lista de
// sus proveedores. Los datos vienen de /api/mapa/proveedores y respetan la categoría
// elegida en el buscador de arriba.
const COLOR_MAPA = '#7D381B';
const COLOR_MIO = '#2b8a3e';
const marcadoresMapa = new Map();

function inicializarMapa() {
    // Sin zoom con la rueda: así la página se puede desplazar sobre el mapa
    mapa = L.map('mapa-interactivo', { scrollWheelZoom: false }).setView([12.85, -85.2], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; colaboradores de OpenStreetMap'
    }).addTo(mapa);
    mapa.on('click', () => mapa.scrollWheelZoom.enable());
    capaMapa = L.layerGroup().addTo(mapa);
    cargarMapa();
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function filaProveedor(p, conBotones = true) {
    const miId = Number(localStorage.getItem('userId'));
    const estrellas = p.totalCalificaciones ? ` · ★ ${Number(p.calificacion).toFixed(1)}` : '';
    const meta = `${plural(p.ofertas, 'publicación', 'publicaciones')}${estrellas}${p.especialidad ? ' · ' + p.especialidad : ''}`;
    const botones = !conBotones ? '' : `
        <span style="display:flex; gap:4px;">
            ${p.ofertas ? `<button type="button" class="btn-sm" data-ver-proveedor="${Number(p.id)}" data-nombre="${esc(p.nombre)}">Ver</button>` : ''}
            ${p.id === miId ? '' : `<a class="btn-sm" style="text-decoration:none;" href="chat.html?contacto=${Number(p.id)}" aria-label="Escribirle a ${esc(p.nombre)}"><i class="ti ti-message-circle" aria-hidden="true"></i></a>`}
        </span>`;
    return `<div class="prov-fila"><span><strong>${enlacePerfil(p.id, p.nombre)}</strong><span class="prov-meta">${esc(meta)}</span></span>${botones}</div>`;
}

function popupDepartamento(d) {
    const miId = Number(localStorage.getItem('userId'));
    return `<div class="popup-prov">
        <h4>${esc(d.departamento)} · ${plural(d.proveedores.length, 'proveedor', 'proveedores')}</h4>
        <ul>${d.proveedores.map(p => `
            <li><strong>${enlacePerfil(p.id, p.nombre)}</strong><br>
                <span style="color:#666">${esc(plural(p.ofertas, 'publicación', 'publicaciones'))}${p.categorias.length ? ' · ' + esc(p.categorias.slice(0, 3).join(', ')) : ''}</span><br>
                ${p.ofertas ? `<button type="button" data-ver-proveedor="${Number(p.id)}" data-nombre="${esc(p.nombre)}">Ver publicaciones</button>` : ''}
                ${p.id === miId ? '' : `<button type="button" data-chat-proveedor="${Number(p.id)}">Escribir</button>`}
            </li>`).join('')}
        </ul></div>`;
}

async function cargarMapa() {
    const resumen = document.getElementById('mapa-resumen');
    const lista = document.getElementById('lista-mapa');
    const select = document.getElementById('searchCategory');
    const categoria = select.value && select.value !== 'todos' ? select.value : '';
    const leyendaCat = document.getElementById('leyenda-categoria');
    leyendaCat.style.display = categoria ? '' : 'none';
    leyendaCat.textContent = categoria ? `Solo quienes venden: ${select.options[select.selectedIndex].text}` : '';
    resumen.textContent = 'Cargando proveedores…';
    try {
        const res = await fetch(`${API_URL}/api/mapa/proveedores${categoria ? '?categoria=' + encodeURIComponent(categoria) : ''}`);
        if (!res.ok) throw new Error('sin datos');
        const datos = await res.json();
        pintarMapa(datos);
        const enMapa = datos.total - datos.sinUbicacion.length;
        resumen.textContent = datos.total
            ? `${plural(enMapa, 'proveedor', 'proveedores')} en ${plural(datos.departamentos.length, 'departamento', 'departamentos')}`
            : 'No hay proveedores que coincidan.';
        lista.innerHTML = datos.departamentos.map(d => `
            <section class="depto-card ${datos.miUbicacion && datos.miUbicacion.nombre === d.departamento ? 'mio' : ''}">
                <h4 role="button" tabindex="0" data-depto="${esc(d.departamento)}" title="Ver en el mapa">${esc(d.departamento)} <small>${plural(d.proveedores.length, 'proveedor', 'proveedores')}</small></h4>
                ${d.proveedores.map(p => filaProveedor(p)).join('')}
            </section>`).join('') + (datos.sinUbicacion.length ? `
            <section class="depto-card">
                <h4>Sin ubicación en el mapa <small>${datos.sinUbicacion.length}</small></h4>
                <p class="nota-bloque" style="margin-bottom:4px;">Escribieron un departamento que no reconocemos.</p>
                ${datos.sinUbicacion.map(p => filaProveedor(p)).join('')}
            </section>` : '');
        if (!datos.total) lista.innerHTML = '<p class="vacio-oscuro">No hay proveedores que vendan esa categoría todavía.</p>';
    } catch (e) {
        resumen.textContent = 'No se pudo cargar el mapa.';
        lista.innerHTML = '';
    }
}

function pintarMapa(datos) {
    capaMapa.clearLayers();
    marcadoresMapa.clear();
    const puntos = [];
    const mio = datos.miUbicacion ? datos.miUbicacion.nombre : null;
    for (const d of datos.departamentos) {
        const esMio = d.departamento === mio;
        const marcador = L.circleMarker([d.lat, d.lng], {
            radius: Math.min(30, 9 + 4 * Math.sqrt(d.proveedores.length)),
            color: '#fff', weight: 2,
            fillColor: esMio ? COLOR_MIO : COLOR_MAPA, fillOpacity: 0.85
        }).bindPopup(popupDepartamento(d), { maxWidth: 280, autoPanPadding: [20, 20] })
          .bindTooltip(`${d.departamento}: ${plural(d.proveedores.length, 'proveedor', 'proveedores')}`);
        marcador.addTo(capaMapa);
        marcadoresMapa.set(d.departamento, marcador);
        puntos.push([d.lat, d.lng]);
    }
    if (datos.miUbicacion && !datos.departamentos.some(d => d.departamento === mio)) {
        L.circleMarker([datos.miUbicacion.lat, datos.miUbicacion.lng], { radius: 7, color: '#fff', weight: 2, fillColor: COLOR_MIO, fillOpacity: 0.9 })
            .bindTooltip(`Tú: ${datos.miUbicacion.nombre}`).addTo(capaMapa);
        puntos.push([datos.miUbicacion.lat, datos.miUbicacion.lng]);
    }
    if (puntos.length > 1) mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 9 });
    else if (puntos.length === 1) mapa.setView(puntos[0], 9);
    else mapa.setView([12.85, -85.2], 7);
}

// Botones de los popups y de la lista (se crean con innerHTML: se escuchan desde el documento)
document.addEventListener('click', (e) => {
    const ver = e.target.closest('[data-ver-proveedor]');
    if (ver) return verPublicacionesDe(ver.dataset.verProveedor, ver.dataset.nombre);
    const chat = e.target.closest('[data-chat-proveedor]');
    if (chat) { window.location.href = `chat.html?contacto=${Number(chat.dataset.chatProveedor)}`; return; }
    const depto = e.target.closest('[data-depto]');
    if (depto) enfocarDepartamento(depto.dataset.depto);
});
document.addEventListener('keydown', (e) => {
    const depto = e.target.closest && e.target.closest('[data-depto]');
    if (depto && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); enfocarDepartamento(depto.dataset.depto); }
});

function enfocarDepartamento(nombre) {
    const marcador = marcadoresMapa.get(nombre);
    if (!marcador) return;
    document.getElementById('mapa-interactivo').scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Sin animación: así el mapa se puede mover solo para que la ventana del popup quepa entera
    mapa.setView(marcador.getLatLng(), 9, { animate: false });
    setTimeout(() => marcador.openPopup(), 350);
}
