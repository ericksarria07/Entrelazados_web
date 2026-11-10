/* ==========================================================================
   MERCADO: núcleo de la página (mercado.html)
   Estado compartido, inicio, ofertas, subastas y pujas, pestañas y tiempo real.
   Los demás archivos de la página usan las variables y funciones de este:
     mercado-publicar.js   fotos, publicar/editar una oferta, crear una subasta y el asistente de IA
     mercado-favoritos.js  favoritos (corazón) y alertas de búsqueda
     mercado-mapa.js       mapa de proveedores por departamento (Leaflet)
   Son scripts normales (no módulos) para que los onclick="..." del HTML sigan
   funcionando; se cargan al final del <body> en ese orden.
   ========================================================================== */
let mapa;
const API_URL = window.location.origin;

// Ofertas de la página que se está viendo (el servidor filtra y pagina)
let todasLasOfertas = [];
let fotosPublicacion = [];
// Edición de una publicación: su ID, las fotos que ya tiene y las que se quitarán
let ofertaEditando = null;
let fotosExistentes = [];
let fotosQuitar = [];
let misPublicaciones = [];
const POR_PAGINA_OFERTAS = 10;
const POR_PAGINA_SUBASTAS = 8;
const POR_PAGINA_FAVORITOS = 6;
let paginaOfertas = 1;
let paginaSubastas = 1;
let paginaFavoritos = 1;
// Favoritos: números de las publicaciones que guardé (para pintar los corazones)
let favoritosIds = new Set();
// "Mostrando solo...": una publicación (?oferta=ID, desde una notificación) o un proveedor (?proveedor=ID, desde el mapa)
let filtroFijo = null;
// Mapa: capa con los círculos de los departamentos
let capaMapa = null;

document.addEventListener('DOMContentLoaded', async () => {
    const userEmail = localStorage.getItem('userEmail');
    const userNombre = localStorage.getItem('userNombre') || 'Usuario';
    const userRol = localStorage.getItem('userRol') || 'Miembro';
    const userId = localStorage.getItem('userId');

    if (!userEmail) {
        window.location.href = 'login.html';
        return;
    }

    // ENLACE AL PANEL DE CONTROL SI EL USUARIO ES ADMINISTRADOR
    const miRolLimpio = userRol.toLowerCase().trim();
    const subBar = document.querySelector('.sub-bar');
    if ((miRolLimpio === 'administrador' || miRolLimpio === 'admin') && subBar) {
        if (!document.getElementById('nav-admin-link')) {
            const adminLink = document.createElement('a');
            adminLink.id = 'nav-admin-link';
            adminLink.href = 'admin.html';
            adminLink.style.color = '#f59f00';
            adminLink.innerHTML = '<i class="ti ti-shield-check"></i> Panel Admin';
            subBar.appendChild(adminLink);
        }
    }

    let departamento = localStorage.getItem('userDepartamento') || localStorage.getItem('userDepto');

    if (!departamento && userId) {
        try {
            const res = await fetch(`${API_URL}/api/perfil/${userId}`);
            if (res.ok) {
                const data = await res.json();
                departamento = data.NombreDepartamento || 'Managua';
                localStorage.setItem('userDepartamento', departamento);
            }
        } catch (err) {
            console.error("Error al obtener la ubicación del usuario:", err);
        }
    }

    const locationElem = document.getElementById('user-location');
    if (locationElem) {
        locationElem.textContent = departamento || 'Managua';
    }

    const authArea = document.getElementById('authArea');
    if (authArea) {
        authArea.innerHTML = `
            <div class="user-dropdown-wrapper">
                <button class="user-btn-nav" onclick="toggleUserDropdown(event)" aria-haspopup="true" aria-label="Menú de ${esc(userNombre)}">
                    <i class="ti ti-user-circle" style="font-size: 22px;"></i>
                    <div class="user-nav-text">
                        <span class="user-nav-name">${esc(userNombre)}</span>
                        <span class="user-nav-role">${esc(userRol.toUpperCase())}</span>
                    </div>
                    <i class="ti ti-chevron-down" style="font-size: 14px; margin-left: 2px;"></i>
                </button>

                <div class="dropdown-menu-nav" id="userDropdownMenu">
                    <a href="perfil.html" class="dropdown-item-nav">
                        <i class="ti ti-id" style="font-size: 18px; color: var(--color-principal);"></i>
                        Ver mi perfil
                    </a>
                    <div class="dropdown-divider-nav"></div>
                    <a href="javascript:void(0)" onclick="cerrarSesion()" class="dropdown-item-nav logout-item">
                        <i class="ti ti-logout" style="font-size: 18px;"></i>
                        Cerrar sesión
                    </a>
                </div>
            </div>
        `;
    }

    // PERMITIR CREACIÓN DE OFERTAS/SUBASTAS A PROVEEDORES Y ADMINISTRADORES
    if (miRolLimpio === 'proveedor' || miRolLimpio === 'administrador' || miRolLimpio === 'admin') {
        const btnPublicar = document.getElementById('btn-publicar-modal');
        const btnSubasta = document.getElementById('btn-subasta-modal');
        if (btnPublicar) btnPublicar.style.display = 'inline-flex';
        if (btnSubasta) btnSubasta.style.display = 'inline-flex';
    }

    const urlParams = new URLSearchParams(window.location.search);
    const qParam = urlParams.get('q');
    const catParam = urlParams.get('categoria');
    const radioParam = urlParams.get('radio');

    if (qParam) document.getElementById('searchInput').value = qParam;
    if (radioParam) {
        document.getElementById('range-km').value = radioParam;
        document.getElementById('range-val').textContent = `${radioParam}km`;
    }

    // Enlaces de una notificación (?oferta=ID) o del mapa (?proveedor=ID&nombre=...)
    const ofertaParam = parseInt(urlParams.get('oferta'), 10);
    const proveedorParam = parseInt(urlParams.get('proveedor'), 10);
    if (ofertaParam > 0) filtroFijo = { tipo: 'oferta', id: ofertaParam, texto: 'Mostrando la publicación del aviso que abriste.' };
    else if (proveedorParam > 0) filtroFijo = { tipo: 'proveedor', id: proveedorParam, texto: `Mostrando las publicaciones de ${urlParams.get('nombre') || 'este proveedor'}.` };

    // Primero las categorías: ?categoria= tiene que estar elegida antes de pedir las ofertas
    await Promise.all([prepararCategorias(catParam), cargarIdsFavoritos()]);
    cargarOfertasDesdeBD(1);
    cargarSubastasDesdeBD(1);
});

// Llena los tres <select> de categorías con las de la base de datos.
// ?categoria= puede traer el ID o, en enlaces viejos, un texto como "Cuero Vacuno".
async function prepararCategorias(catParam) {
    const lista = await Categorias.cargar();
    let elegida = null;
    if (catParam) {
        elegida = lista.some(c => String(c.CategoriaID) === catParam) ? catParam : Categorias.buscarPorTexto(lista, catParam);
    }
    Categorias.llenarSelect(document.getElementById('searchCategory'), lista,
        { primera: { valor: 'todos', texto: 'Todos los insumos' }, seleccionada: elegida || 'todos' });
    const placeholder = { valor: '', texto: '-- Selecciona una categoría --', deshabilitada: true };
    Categorias.llenarSelect(document.getElementById('ofertaCategoria'), lista, { primera: placeholder });
    Categorias.llenarSelect(document.getElementById('subastaCategoria'), lista, { primera: placeholder });
    Categorias.llenarSelect(document.getElementById('alertaCategoria'), lista, { primera: { valor: '', texto: 'Cualquier categoría' } });
}

// Filtros del buscador (texto y categoría) compartidos por ofertas y subastas
function parametrosBusqueda() {
    const params = new URLSearchParams();
    const texto = document.getElementById('searchInput').value.trim();
    const categoria = document.getElementById('searchCategory').value;
    if (texto) params.set('q', texto);
    if (categoria && categoria !== 'todos') params.set('categoria', categoria);
    return params;
}

// Controles "Anterior / Página X de Y / Siguiente" bajo cada lista
function pintarPaginacion(idContenedor, datos, funcion) {
    const caja = document.getElementById(idContenedor);
    if (!datos || datos.total === 0 || datos.paginas <= 1) { caja.innerHTML = ''; return; }
    caja.innerHTML = `
        <button class="btn-sm" ${datos.pagina <= 1 ? 'disabled' : ''} onclick="${funcion}(${datos.pagina - 1}, true)"><i class="ti ti-chevron-left"></i> Anterior</button>
        <span>Página <strong>${datos.pagina}</strong> de ${datos.paginas} · ${datos.total} resultado${datos.total === 1 ? '' : 's'}</span>
        <button class="btn-sm" ${datos.pagina >= datos.paginas ? 'disabled' : ''} onclick="${funcion}(${datos.pagina + 1}, true)">Siguiente <i class="ti ti-chevron-right"></i></button>`;
}

// Nombre del proveedor que lleva a su perfil público (perfil-publico.html?id=)
const enlacePerfil = (id, nombre) =>
    `<a class="enlace-perfil" href="perfil-publico.html?id=${Number(id)}" title="Ver el perfil de ${esc(nombre)}">${esc(nombre)}</a>`;

// "★ 4.5 (3)" o "Sin calificaciones"
function estrellasHTML(promedio, total) {
    if (!total) return '<span class="sin-calificar">Sin calificaciones</span>';
    return `<span class="estrellas" title="${esc(promedio)} de 5 en ${total} trato${total === 1 ? '' : 's'} completado${total === 1 ? '' : 's'}"><i class="ti ti-star-filled"></i> ${Number(promedio).toFixed(1)} <small>(${total})</small></span>`;
}

async function cargarOfertasDesdeBD(pagina = paginaOfertas, desplazar = false) {
    paginaOfertas = pagina;
    // Con un filtro fijo (una publicación o un proveedor) se ignoran el buscador y la distancia
    const params = filtroFijo ? new URLSearchParams() : parametrosBusqueda();
    params.set('pagina', pagina);
    params.set('porPagina', POR_PAGINA_OFERTAS);
    if (filtroFijo) params.set(filtroFijo.tipo === 'oferta' ? 'id' : 'proveedorId', filtroFijo.id);
    else params.set('maxKm', document.getElementById('range-km').value);
    const aviso = document.getElementById('aviso-filtro');
    aviso.hidden = !filtroFijo;
    if (filtroFijo) document.getElementById('texto-aviso-filtro').textContent = filtroFijo.texto;
    try {
        const response = await fetch(`${API_URL}/api/ofertas?${params}`);
        if (!response.ok) throw new Error("Error backend");
        const datos = await response.json();
        // Se borró lo último de la última página: se muestra la anterior
        if (datos.datos.length === 0 && datos.total > 0 && pagina > 1) return cargarOfertasDesdeBD(datos.paginas);
        todasLasOfertas = datos.datos;
        renderizarListaOfertas(datos);
        if (desplazar) document.getElementById('tab-listings').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        document.getElementById('contenedor-ofertas').innerHTML = `<p style="text-align:center; color:#c92a2a; padding: 20px;">Error al conectar con la base de datos.</p>`;
        document.getElementById('paginacion-ofertas').innerHTML = '';
    }
}

// Al cambiar un filtro se vuelve a pedir la página 1 (con una pequeña espera
// para no hacer una petición por cada movimiento del control de distancia)
let temporizadorFiltros = null;
function renderizarOfertasFiltradas() {
    clearTimeout(temporizadorFiltros);
    temporizadorFiltros = setTimeout(() => {
        cargarOfertasDesdeBD(1);
        cargarSubastasDesdeBD(1);
        if (mapa && pestanaVisible('map')) cargarMapa();
    }, 250);
}

function renderizarListaOfertas(datos) {
    const contenedor = document.getElementById('contenedor-ofertas');
    const maxKm = document.getElementById('range-km').value;

    pintarPaginacion('paginacion-ofertas', datos, 'cargarOfertasDesdeBD');

    if (datos.datos.length === 0) {
        contenedor.innerHTML = filtroFijo
            ? `<p class="vacio-oscuro"><i class="ti ti-info-circle"></i> ${filtroFijo.tipo === 'oferta' ? 'Esa publicación ya no está disponible.' : 'Este proveedor no tiene publicaciones por ahora.'}</p>`
            : `<p class="vacio-oscuro"><i class="ti ti-info-circle"></i> No hay ofertas disponibles que coincidan con tus filtros dentro de un radio de ${esc(maxKm)}km.</p>`;
        return;
    }
    contenedor.innerHTML = datos.datos.map(tarjetaOferta).join('');
}

// Tarjeta de una publicación (la usan la lista de ofertas y la de favoritos)
function tarjetaOferta(oferta) {
    const miUserId = localStorage.getItem('userId');
    const miRol = (localStorage.getItem('userRol') || '').toLowerCase().trim();
    const esAdmin = (miRol === 'administrador' || miRol === 'admin');
    const iconoCat = (oferta.NombreCategoria || '').toLowerCase().includes('cuero') ? 'ti-cow' : 'ti-shoe';

    const tieneImagen = oferta.Fotos && oferta.Fotos.length > 0;
    const contenidoAvatar = tieneImagen
        ? `<img src="${esc(oferta.Fotos[0])}" alt="Foto de ${esc(oferta.TituloMaterial)}" loading="lazy">`
        : `<i class="ti ${iconoCat}" aria-hidden="true"></i>`;

    const esDueno = parseInt(miUserId) === parseInt(oferta.ProveedorID);
    const id = Number(oferta.OfertaID);

    // Editar y eliminar: el dueño de la publicación y el administrador
    let botonesGestion = '';
    if (esDueno && (miRol === 'proveedor' || esAdmin)) {
        botonesGestion = `
            <button class="btn-sm" style="margin-left: auto;" onclick="abrirModalEdicion(${id})"><i class="ti ti-pencil"></i> Editar</button>
            <button class="btn-sm" style="background-color: #c92a2a; color: white; border: none;" onclick="eliminarOferta(${id})"><i class="ti ti-trash"></i> Eliminar</button>`;
    } else if (esAdmin) {
        botonesGestion = `
            <button class="btn-sm" style="margin-left: auto;" onclick="abrirModalEdicion(${id})"><i class="ti ti-pencil"></i> Admin: Editar</button>
            <button class="btn-sm" style="background-color: #d9480f; color: white; border: none;" onclick="eliminarOferta(${id})"><i class="ti ti-shield-x"></i> Admin: Eliminar</button>`;
    }
    // "Contactar Proveedor" abre el chat directamente con quien publicó (no con uno mismo)
    const botonContactar = esDueno ? '<span style="font-size:12px; color:var(--text-muted);"><i class="ti ti-user-check"></i> Tu publicación</span>'
        : `<a href="chat.html?contacto=${Number(oferta.ProveedorID)}" class="btn-sm" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px;"><i class="ti ti-message-circle"></i> Contactar Proveedor</a>`;
    // El corazón: no se puede guardar una publicación propia
    const guardada = favoritosIds.has(id);
    const botonFavorito = esDueno ? '' : `
        <button type="button" class="btn-fav" data-fav="${id}" aria-pressed="${guardada}"
                aria-label="${guardada ? 'Quitar de favoritos' : 'Guardar en favoritos'}: ${esc(oferta.TituloMaterial)}"
                title="${guardada ? 'Quitar de favoritos' : 'Guardar en favoritos'}" onclick="alternarFavorito(${id})">
            <i class="ti ${guardada ? 'ti-heart-filled' : 'ti-heart'}" aria-hidden="true"></i>
        </button>`;

    return `
        <article class="listing-card" data-oferta="${id}">
            <div class="listing-top">
                <div class="listing-avatar">${contenidoAvatar}</div>
                <div class="listing-info">
                    <h3 class="listing-name">${esc(oferta.TituloMaterial)}</h3>
                    <div class="listing-sub">${enlacePerfil(oferta.ProveedorID, oferta.NombreProveedor || 'Proveedor local')} · ${estrellasHTML(oferta.CalificacionProveedor, oferta.TotalCalificaciones)} · Ubicado a ${Number(oferta.DistanciaSimuladaKm) || 0} km</div>
                    <div class="listing-badges">
                        <span class="badge badge-verified"><i class="ti ti-shield-check" style="font-size:10px" aria-hidden="true"></i> Verificado</span>
                        <span class="badge badge-mat">${esc(oferta.NombreCategoria)}</span>
                        ${tieneImagen ? `<span class="badge badge-mat"><i class="ti ti-photo" aria-hidden="true"></i> ${oferta.Fotos.length} foto(s)</span>` : ''}
                    </div>
                </div>
                <div style="text-align:right;">
                    <div class="listing-price">C$ ${parseFloat(oferta.Precio).toFixed(2)}</div>
                    <div class="listing-punit">${esc(oferta.UnidadMedida)}</div>
                </div>
            </div>
            ${oferta.Descripcion ? `<p class="listing-desc">${esc(oferta.Descripcion)}</p>` : ''}
            <div class="listing-bottom" style="display:flex; align-items:center; gap:10px; flex-wrap: wrap;">
                ${botonFavorito}
                ${botonContactar}
                ${botonesGestion}
            </div>
        </article>
    `;
}

// ------------------------------------------------------------ FILTRO FIJO
function verPublicacionesDe(proveedorId, nombre) {
    filtroFijo = { tipo: 'proveedor', id: Number(proveedorId), texto: `Mostrando las publicaciones de ${nombre || 'este proveedor'}.` };
    if (mapa) mapa.closePopup();
    switchMarketTab(document.querySelector(".tab[onclick*=\"'listings'\"]"), 'listings', true);
    cargarOfertasDesdeBD(1, true);
}

function quitarFiltroFijo() {
    filtroFijo = null;
    // Se quita ?oferta= o ?proveedor= de la dirección para que al recargar se vean todas
    const url = new URL(window.location.href);
    ['oferta', 'proveedor', 'nombre'].forEach(p => url.searchParams.delete(p));
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    cargarOfertasDesdeBD(1);
}

function actualizarFiltroKilometros(valor) {
    document.getElementById('range-val').textContent = valor + 'km';
    renderizarOfertasFiltradas();
}

async function eliminarOferta(ofertaId) {
    if (!confirm("¿Estás seguro de que deseas eliminar esta oferta?")) return;
    const miUserId = localStorage.getItem('userId');

    try {
        const response = await fetch(`${API_URL}/api/ofertas/${ofertaId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proveedorId: parseInt(miUserId) })
        });
        const res = await response.json();
        if (response.ok) {
            alert(res.message || "Oferta eliminada exitosamente.");
            cargarOfertasDesdeBD();
            cargarSubastasDesdeBD();
            misPublicaciones = [];
        } else {
            alert(res.message);
        }
    } catch (error) {
        alert("Error al conectar con el servidor.");
    }
}

async function cargarSubastasDesdeBD(pagina = paginaSubastas, desplazar = false) {
    paginaSubastas = pagina;
    const contenedor = document.getElementById('contenedor-subastas');
    const miUserId = parseInt(localStorage.getItem('userId'));
    const miRol = (localStorage.getItem('userRol') || '').toLowerCase().trim();
    const esAdmin = (miRol === 'administrador' || miRol === 'admin');
    const params = parametrosBusqueda();
    params.set('pagina', pagina);
    params.set('porPagina', POR_PAGINA_SUBASTAS);

    try {
        const response = await fetch(`${API_URL}/api/subastas?${params}`);
        if (!response.ok) throw new Error("Error consultando subastas");
        const datos = await response.json();
        if (datos.datos.length === 0 && datos.total > 0 && pagina > 1) return cargarSubastasDesdeBD(datos.paginas);
        const subastas = datos.datos;
        contenedor.innerHTML = '';
        pintarPaginacion('paginacion-subastas', datos, 'cargarSubastasDesdeBD');
        if (desplazar) document.getElementById('tab-auctions').scrollIntoView({ behavior: 'smooth' });

        if (subastas.length === 0) {
            const hayFiltros = [...parametrosBusqueda().keys()].length > 0;
            contenedor.innerHTML = `<p style="text-align:center; color:var(--text-muted); margin-top:20px;">${hayFiltros ? 'No hay subastas activas que coincidan con tu búsqueda.' : 'No hay lotes en subasta activa actualmente.'}</p>`;
            return;
        }

        subastas.forEach(subasta => {
            const esMiSubasta = (parseInt(subasta.ProveedorID) === miUserId);
            const esProveedor = (miRol === 'proveedor');
            const deshabilitarPujas = esProveedor || esMiSubasta;
            // En la base se guardan como "Lote Subasta: <material>"; en la tarjeta basta el material
            const nombreLote = String(subasta.TituloLote || '').replace(/^Lote Subasta:\s*/i, '') || subasta.TituloLote;
            const tiempo = tiempoRestante(subasta.FechaFin);
            const avatar = subasta.Foto
                ? `<img src="${esc(subasta.Foto)}" alt="${esc(nombreLote)}" loading="lazy">`
                : '<i class="ti ti-gavel"></i>';
            const pujas = Number(subasta.TotalPujas) || 0;

            contenedor.innerHTML += `
                <div class="auction-card">
                    <div class="auction-top">
                        <div class="listing-avatar">${avatar}</div>
                        <div class="auction-header">
                            <div>
                                <div class="auction-title">${esc(nombreLote)} ${esMiSubasta ? ' <span style="color:var(--color-principal); font-size:12px;">(Tu Lote)</span>' : ''}</div>
                                <div class="auction-sub">
                                    ${subasta.NombreCategoria ? `<span class="badge badge-mat">${esc(subasta.NombreCategoria)}</span>` : ''}
                                    <span class="badge badge-mat" id="subasta-pujas-${subasta.SubastaID}"><i class="ti ti-hammer" style="font-size:10px"></i> ${pujas} puja${pujas === 1 ? '' : 's'}</span>
                                </div>
                            </div>
                            <div class="auction-timer ${tiempo.pronto ? 'pronto' : ''}" title="Cierra el ${esc(new Date(subasta.FechaFin).toLocaleString('es-NI'))}"><i class="ti ti-clock"></i> ${esc(tiempo.texto)}</div>
                        </div>
                    </div>
                    <div class="auction-body">
                        <div class="bid-track">
                            <div class="bid-row">
                                <span class="bid-label">Precio base: C$ ${parseFloat(subasta.PrecioBase).toLocaleString()}</span>
                                <div class="bid-amount" id="subasta-val-${subasta.SubastaID}" data-precio="${Number(subasta.PrecioActual)}" aria-live="polite">C$ ${parseFloat(subasta.PrecioActual).toLocaleString()}</div>
                            </div>
                        </div>
                        <div class="bid-input-row">
                            <input class="bid-input" type="number" placeholder="Tu oferta en C$" id="subasta-input-${subasta.SubastaID}" ${deshabilitarPujas ? 'disabled style="background:#f4f1ea; cursor:not-allowed;"' : ''}>
                            <button class="btn-sm cta" 
                                    style="${deshabilitarPujas ? 'background-color:#b0a8a0; cursor:not-allowed;' : ''}"
                                    onclick="${deshabilitarPujas ? "alert('Los proveedores o propietarios no pueden realizar ofertas en sus propias subastas.')" : `ejecutarPujaReal(${subasta.SubastaID},${subasta.PrecioActual})`}"
                                    ${deshabilitarPujas ? 'disabled' : ''}>
                                ${deshabilitarPujas ? 'Bloqueado' : 'Pujar'}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });
    } catch (error) {
        contenedor.innerHTML = `<p style="text-align:center; color:#c92a2a; padding: 20px;">No se pudieron cargar las subastas.</p>`;
        document.getElementById('paginacion-subastas').innerHTML = '';
    }
}

// "Cierra en 3 d 4 h", "Cierra en 2 h 10 min"... (pronto = menos de 24 horas)
function tiempoRestante(fechaFin) {
    const minutos = Math.max(0, Math.floor((new Date(fechaFin) - Date.now()) / 60000));
    const dias = Math.floor(minutos / 1440), horas = Math.floor((minutos % 1440) / 60), mins = minutos % 60;
    let texto;
    if (dias > 0) texto = `Cierra en ${dias} d ${horas} h`;
    else if (horas > 0) texto = `Cierra en ${horas} h ${mins} min`;
    else texto = minutos > 0 ? `Cierra en ${mins} min` : 'Cerrando…';
    return { texto, pronto: minutos < 1440 };
}

async function ejecutarPujaReal(subastaId, precioActual) {
    const input = document.getElementById(`subasta-input-${subastaId}`);
    // El precio pudo subir mientras tanto (tiempo real): se usa el que muestra la tarjeta
    const precioEnPantalla = Number((document.getElementById(`subasta-val-${subastaId}`) || {}).dataset?.precio);
    if (precioEnPantalla > 0) precioActual = precioEnPantalla;
    const montoPuja = parseFloat(input.value);
    const emprendedorId = localStorage.getItem('userId');
    const miRol = (localStorage.getItem('userRol') || '').toLowerCase().trim();

    if (miRol === 'proveedor') {
        alert("Los proveedores no pueden realizar pujas.");
        return;
    }

    if (!montoPuja || montoPuja <= precioActual) {
        alert(`Tu puja debe ser mayor al precio actual de C$${precioActual.toLocaleString()}`);
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/pujas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subastaId, emprendedorId: parseInt(emprendedorId), montoPuja })
        });

        const resData = await response.json();
        if (response.ok) {
            alert(resData.message);
            input.value = '';
            cargarSubastasDesdeBD();
        } else {
            alert("Error: " + resData.message);
        }
    } catch (error) {
        alert("No se pudo procesar la puja con el servidor.");
    }
}

// sinCargar: quien llama ya pide los datos (p. ej. verPublicacionesDe)
function switchMarketTab(el, tab, sinCargar = false) {
    document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    el.classList.add('active');
    el.setAttribute('aria-selected', 'true');
    ['listings', 'auctions', 'map', 'favorites'].forEach(id => {
        document.getElementById('tab-' + id).style.display = id === tab ? 'block' : 'none';
    });

    // MANTENER VISIBILIDAD DE BOTONES PARA PROVEEDORES Y ADMINISTRADORES
    const miRolLimpio = (localStorage.getItem('userRol') || '').toLowerCase().trim();
    if (miRolLimpio === 'proveedor' || miRolLimpio === 'administrador' || miRolLimpio === 'admin') {
        const btnPub = document.getElementById('btn-publicar-modal');
        const btnSub = document.getElementById('btn-subasta-modal');
        if (btnPub) btnPub.style.display = 'inline-flex';
        if (btnSub) btnSub.style.display = 'inline-flex';
    }

    if (sinCargar) return;
    if (tab === 'listings') cargarOfertasDesdeBD();
    if (tab === 'auctions') cargarSubastasDesdeBD();
    if (tab === 'favorites') { cargarFavoritos(); cargarAlertas(); }
    if (tab === 'map') {
        setTimeout(() => {
            if (!mapa) { inicializarMapa(); }
            else { mapa.invalidateSize(); cargarMapa(); }
        }, 200);
    }
}

const pestanaVisible = (id) => document.getElementById('tab-' + id).style.display !== 'none';

async function ejecutarBusqueda(event) {
    event.preventDefault();
    renderizarOfertasFiltradas();
}

// ------------------------------------------------------------ TIEMPO REAL
// sesion.js reenvía los avisos del servidor. Cuando alguien puja, el precio de la
// tarjeta cambia solo; si se crea, cancela o cierra una subasta, la lista se recarga.
document.addEventListener('entrelazados:puja:nueva', (evento) => {
    const { subastaId, precioActual, totalPujas } = evento.detail || {};
    const valor = document.getElementById(`subasta-val-${subastaId}`);
    if (!valor) return;
    valor.dataset.precio = precioActual;
    valor.textContent = `C$ ${Number(precioActual).toLocaleString()}`;
    valor.classList.remove('recien-pujado');
    void valor.offsetWidth;
    valor.classList.add('recien-pujado');
    const badge = document.getElementById(`subasta-pujas-${subastaId}`);
    if (badge) badge.innerHTML = `<i class="ti ti-hammer" style="font-size:10px"></i> ${totalPujas} puja${totalPujas === 1 ? '' : 's'}`;
});

let recargaSubastasPendiente = null;
document.addEventListener('entrelazados:subastas:cambio', () => {
    clearTimeout(recargaSubastasPendiente);
    recargaSubastasPendiente = setTimeout(function recargar() {
        // No se recarga mientras alguien escribe su puja (perdería lo escrito)
        const escribiendo = document.activeElement && document.activeElement.classList.contains('bid-input') && document.activeElement.value;
        if (escribiendo) { recargaSubastasPendiente = setTimeout(recargar, 3000); return; }
        cargarSubastasDesdeBD();
    }, 800);
});

// Las notificaciones de subastas llevan a mercado.html#tab-auctions: se abre esa pestaña
// (#tab-favorites abre los favoritos y las alertas)
function abrirPestanaDelEnlace() {
    const pestana = { '#tab-auctions': 'auctions', '#tab-favorites': 'favorites', '#tab-map': 'map' }[window.location.hash];
    if (!pestana) return;
    const boton = document.querySelector(`.tab[onclick*="'${pestana}'"]`);
    if (boton) switchMarketTab(boton, pestana);
}
document.addEventListener('DOMContentLoaded', abrirPestanaDelEnlace);
window.addEventListener('hashchange', abrirPestanaDelEnlace);

// Indicador "En vivo" junto al título de las subastas
document.addEventListener('entrelazados:conexion', (evento) => {
    const indicador = document.getElementById('indicador-en-vivo');
    if (indicador) indicador.hidden = !(evento.detail && evento.detail.conectado);
});
