/* ==========================================================================
   MERCADO: favoritos y alertas de búsqueda (mercado.html)
   El corazón de cada tarjeta, la pestaña "Favoritos y Alertas" (paginada) y el
   botón "Avísame de nuevas". Usa el estado de mercado.js.
   ========================================================================== */
// ------------------------------------------------------------ FAVORITOS
async function cargarIdsFavoritos() {
    try {
        const res = await fetch(`${API_URL}/api/favoritos/ids`);
        favoritosIds = new Set(res.ok ? await res.json() : []);
    } catch (e) { favoritosIds = new Set(); }
}

// Guarda o quita una publicación y actualiza todos sus corazones en la página
async function alternarFavorito(ofertaId) {
    const guardada = favoritosIds.has(ofertaId);
    const botones = document.querySelectorAll(`.btn-fav[data-fav="${ofertaId}"]`);
    botones.forEach(b => { b.disabled = true; });
    try {
        const res = await fetch(`${API_URL}/api/favoritos/${ofertaId}`, { method: guardada ? 'DELETE' : 'POST' });
        const datos = await res.json().catch(() => ({}));
        if (!res.ok) { alert(datos.message || 'No se pudo actualizar tus favoritos.'); return; }
        if (guardada) favoritosIds.delete(ofertaId); else favoritosIds.add(ofertaId);
        const ahora = !guardada;
        botones.forEach(b => {
            b.setAttribute('aria-pressed', String(ahora));
            b.title = ahora ? 'Quitar de favoritos' : 'Guardar en favoritos';
            b.setAttribute('aria-label', b.getAttribute('aria-label').replace(/^(Quitar de favoritos|Guardar en favoritos)/, b.title));
            b.querySelector('i').className = `ti ${ahora ? 'ti-heart-filled' : 'ti-heart'}`;
        });
        // En la pestaña de favoritos se vuelve a pedir la página (la siguiente publicación sube a ocupar su lugar)
        if (!ahora && document.querySelector(`#contenedor-favoritos [data-oferta="${ofertaId}"]`)) cargarFavoritos();
    } catch (e) {
        alert('Error al conectar con el servidor.');
    } finally {
        botones.forEach(b => { b.disabled = false; });
    }
}

function pintarFavoritosVacio() {
    document.getElementById('contenedor-favoritos').innerHTML =
        '<p class="vacio-oscuro"><i class="ti ti-heart"></i> Todavía no guardaste publicaciones. Toca el corazón de una oferta para guardarla aquí.</p>';
    document.getElementById('paginacion-favoritos').innerHTML = '';
}

// Publicaciones guardadas, de a POR_PAGINA_FAVORITOS (el servidor pagina)
async function cargarFavoritos(pagina = paginaFavoritos, desplazar = false) {
    paginaFavoritos = pagina;
    const contenedor = document.getElementById('contenedor-favoritos');
    if (!contenedor.querySelector('.listing-card')) contenedor.innerHTML = '<p class="vacio-oscuro">Cargando tus favoritos…</p>';
    try {
        const res = await fetch(`${API_URL}/api/favoritos?pagina=${pagina}&porPagina=${POR_PAGINA_FAVORITOS}`);
        if (!res.ok) throw new Error('sin datos');
        const datos = await res.json();
        // Se quitó lo último de la última página: se muestra la anterior
        if (datos.datos.length === 0 && datos.total > 0 && pagina > 1) return cargarFavoritos(datos.paginas);
        const lista = datos.datos;
        lista.forEach(o => favoritosIds.add(Number(o.OfertaID)));
        // Para poder editar desde aquí (abrirModalEdicion busca en todasLasOfertas)
        const idsLista = new Set(lista.map(o => Number(o.OfertaID)));
        todasLasOfertas = [...todasLasOfertas.filter(o => !idsLista.has(Number(o.OfertaID))), ...lista];
        if (datos.total === 0) return pintarFavoritosVacio();
        contenedor.innerHTML = lista.map(tarjetaOferta).join('');
        pintarPaginacion('paginacion-favoritos', datos, 'cargarFavoritos');
        if (desplazar) contenedor.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        contenedor.innerHTML = '<p class="vacio-oscuro" style="color:#ffb4a8;">No se pudieron cargar tus favoritos.</p>';
        document.getElementById('paginacion-favoritos').innerHTML = '';
    }
}

// ------------------------------------------------------------ ALERTAS DE BÚSQUEDA
async function cargarAlertas() {
    const caja = document.getElementById('lista-alertas');
    try {
        const res = await fetch(`${API_URL}/api/alertas`);
        const alertas = res.ok ? await res.json() : [];
        caja.innerHTML = alertas.length
            ? alertas.map(a => `
                <span class="chip-alerta"><i class="ti ti-bell" aria-hidden="true"></i> ${esc(a.descripcion)}
                    <button type="button" onclick="borrarAlerta(${Number(a.id)})" aria-label="Borrar la alerta ${esc(a.descripcion)}" title="Borrar alerta">&times;</button>
                </span>`).join('')
            : '<span class="nota-bloque" style="margin:0;">Todavía no tienes alertas.</span>';
    } catch (e) {
        caja.innerHTML = '<span class="nota-bloque" style="margin:0;">No se pudieron cargar tus alertas.</span>';
    }
}

async function enviarAlerta(datos) {
    const res = await fetch(`${API_URL}/api/alertas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos)
    });
    const r = await res.json().catch(() => ({}));
    return { ok: res.ok, message: r.message || (res.ok ? 'Alerta creada.' : 'No se pudo crear la alerta.') };
}

async function guardarAlerta(event) {
    event.preventDefault();
    const boton = document.getElementById('btnGuardarAlerta');
    boton.disabled = true;
    try {
        const r = await enviarAlerta({
            palabraClave: document.getElementById('alertaPalabra').value.trim(),
            categoriaId: document.getElementById('alertaCategoria').value || null,
            precioMaximo: document.getElementById('alertaPrecio').value || null
        });
        alert(r.message);
        if (r.ok) {
            event.target.reset();
            cargarAlertas();
        }
    } catch (e) {
        alert('Error al conectar con el servidor.');
    } finally {
        boton.disabled = false;
    }
}

// "Avísame de nuevas": crea una alerta con lo que está escrito en el buscador
async function crearAlertaDeBusqueda() {
    const texto = document.getElementById('searchInput').value.trim();
    const categoria = document.getElementById('searchCategory').value;
    if (!texto && (!categoria || categoria === 'todos')) {
        alert('Escribe qué buscas o elige una categoría en el buscador, o crea la alerta desde "Favoritos y Alertas".');
        switchMarketTab(document.querySelector(".tab[onclick*=\"'favorites'\"]"), 'favorites');
        document.getElementById('alertaPalabra').focus();
        return;
    }
    try {
        const r = await enviarAlerta({ palabraClave: texto, categoriaId: categoria === 'todos' ? null : categoria });
        alert(r.message);
    } catch (e) {
        alert('Error al conectar con el servidor.');
    }
}

async function borrarAlerta(alertaId) {
    try {
        const res = await fetch(`${API_URL}/api/alertas/${alertaId}`, { method: 'DELETE' });
        if (!res.ok) alert((await res.json().catch(() => ({}))).message || 'No se pudo borrar la alerta.');
    } catch (e) {
        alert('Error al conectar con el servidor.');
    }
    cargarAlertas();
}
