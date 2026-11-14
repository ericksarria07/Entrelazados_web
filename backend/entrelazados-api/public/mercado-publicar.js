/* ==========================================================================
   MERCADO: publicar (mercado.html)
   Fotos (se reducen en el navegador), publicar o editar una oferta, crear una
   subasta y el asistente de IA del formulario. Usa el estado de mercado.js.
   ========================================================================== */
// FOTOS DE LA OFERTA
// Cada foto se reduce en el navegador (máx. 1600 px, WebP o JPG) antes de subirla:
// una foto de celular de 4-8 MB queda en unos 200-400 KB y sube rápido con datos móviles.
const MAX_FOTOS = 5;
const LADO_MAXIMO = 1600;

function reducirFoto(archivo) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.naturalWidth * escala);
            canvas.height = Math.round(img.naturalHeight * escala);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                // Safari antiguo no genera WebP: en ese caso se usa JPG
                if (blob && blob.type === 'image/webp') return resolve(blob);
                canvas.toBlob((jpg) => jpg ? resolve(jpg) : reject(new Error('No se pudo procesar la foto')), 'image/jpeg', 0.85);
            }, 'image/webp', 0.82);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('El archivo no es una imagen válida')); };
        img.src = url;
    });
}

async function procesarFotosSeleccionadas(event) {
    const archivos = Array.from(event.target.files);
    event.target.value = '';

    const espacio = MAX_FOTOS - fotosPublicacion.length - fotosExistentesVisibles().length;
    if (archivos.length > espacio) {
        alert(espacio > 0
            ? `Puedes subir como máximo ${MAX_FOTOS} fotos. Se agregarán solo las primeras ${espacio}.`
            : `Ya tienes ${MAX_FOTOS} fotos, el máximo por oferta.`);
    }

    for (const archivo of archivos.slice(0, Math.max(0, espacio))) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type)) {
            alert(`"${archivo.name}" no es una foto JPG, PNG o WebP.`);
            continue;
        }
        try {
            const blob = await reducirFoto(archivo);
            fotosPublicacion.push({ blob, url: URL.createObjectURL(blob) });
            renderizarVistaPreviaFotos();
        } catch (e) {
            alert(`No se pudo usar "${archivo.name}": ${e.message}.`);
        }
    }
}

// Al editar: fotos que la publicación ya tiene y que no se marcaron para quitar
const fotosExistentesVisibles = () => fotosExistentes.filter(url => !fotosQuitar.includes(url));

function renderizarVistaPreviaFotos() {
    const grid = document.getElementById('previewGrid');
    const existentes = fotosExistentes.map((url, index) => fotosQuitar.includes(url) ? '' : `
            <div class="photo-preview-item existente" title="Foto actual">
                <img src="${esc(url)}" alt="Foto actual ${index + 1}">
                <div class="photo-preview-remove" onclick="quitarFotoExistente(${index})" title="Quitar esta foto">&times;</div>
            </div>
        `).join('');
    grid.innerHTML = existentes + fotosPublicacion.map((foto, index) => `
            <div class="photo-preview-item">
                <img src="${foto.url}" alt="Vista previa ${index + 1}">
                <div class="photo-preview-remove" onclick="eliminarFoto(${index})">&times;</div>
            </div>
        `).join('');
}

function quitarFotoExistente(index) {
    const url = fotosExistentes[index];
    if (url && !fotosQuitar.includes(url)) fotosQuitar.push(url);
    renderizarVistaPreviaFotos();
}

function eliminarFoto(index) {
    const [quitada] = fotosPublicacion.splice(index, 1);
    if (quitada) URL.revokeObjectURL(quitada.url);
    renderizarVistaPreviaFotos();
}

async function guardarOferta() {
    const titulo = document.getElementById('ofertaTitulo').value.trim();
    const precio = document.getElementById('ofertaPrecio').value.trim();
    const unidad = document.getElementById('ofertaUnidad').value.trim();
    const distancia = document.getElementById('ofertaDistancia').value.trim();
    const categoriaId = document.getElementById('ofertaCategoria').value;
    const proveedorId = localStorage.getItem('userId');

    if (!proveedorId) { alert("Error de sesión. Inicia sesión nuevamente."); return; }
    if (!titulo || !precio || !unidad || !categoriaId) { alert("Por favor llena todos los campos obligatorios."); return; }

    // Los datos y las fotos viajan juntos como formulario (multipart/form-data)
    const formulario = new FormData();
    const editando = ofertaEditando !== null;
    if (editando && fotosQuitar.length) formulario.append('fotosQuitar', JSON.stringify(fotosQuitar));
    formulario.append('titulo', titulo);
    formulario.append('descripcion', document.getElementById('ofertaDescripcion').value.trim());
    formulario.append('precio', parseFloat(precio));
    formulario.append('unidad', unidad);
    formulario.append('distancia', parseInt(distancia) || 0);
    formulario.append('categoriaId', parseInt(categoriaId));
    fotosPublicacion.forEach((foto, i) => {
        formulario.append('fotos', foto.blob, `foto-${i + 1}.${foto.blob.type === 'image/webp' ? 'webp' : 'jpg'}`);
    });

    const boton = document.getElementById('btnGuardarOferta');
    const textoBoton = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = fotosPublicacion.length ? 'Subiendo fotos…' : (editando ? 'Guardando…' : 'Publicando…');

    try {
        const response = editando
            ? await fetch(`${API_URL}/api/ofertas/${ofertaEditando}`, { method: 'PUT', body: formulario })
            : await fetch(`${API_URL}/api/ofertas`, { method: 'POST', body: formulario });
        const resData = await response.json();
        if (response.ok) {
            alert("¡Éxito! " + resData.message);
            cerrarModal();
            cargarOfertasDesdeBD(editando ? paginaOfertas : 1);
            cargarSubastasDesdeBD();
            misPublicaciones = [];
        } else { alert("Error: " + resData.message); }
    } catch (error) {
        alert("Error de red al guardar la oferta.");
    } finally {
        boton.disabled = false;
        boton.innerHTML = textoBoton;
    }
}

async function guardarSubasta() {
    const ofertaId = document.getElementById('subastaOferta').value;
    const tituloLote = document.getElementById('subastaTitulo').value.trim();
    const precioBase = parseFloat(document.getElementById('subastaPrecioBase').value);
    const categoriaId = document.getElementById('subastaCategoria').value;
    const dias = parseInt(document.getElementById('subastaDias').value, 10);

    if (!tituloLote || !categoriaId || !(precioBase > 0)) {
        alert("Escribe el título del lote, el precio base (mayor que 0) y elige una categoría.");
        return;
    }

    const boton = document.getElementById('btnGuardarSubasta');
    const textoBoton = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = 'Creando subasta…';
    try {
        // El proveedor lo toma el servidor de la sesión; no se envía
        const response = await fetch(`${API_URL}/api/subastas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ofertaId: ofertaId ? parseInt(ofertaId, 10) : null,
                tituloLote,
                precioBase,
                categoriaId: parseInt(categoriaId, 10),
                dias
            })
        });
        const resData = await response.json();
        if (response.ok) {
            alert(resData.message || "¡Subasta creada correctamente!");
            cerrarModalSubasta();
            cargarSubastasDesdeBD();
        } else {
            alert("Error: " + resData.message);
        }
    } catch (error) {
        alert("Error de red al publicar la subasta.");
    } finally {
        boton.disabled = false;
        boton.innerHTML = textoBoton;
    }
}

// Al elegir una publicación propia se copian su título, precio y categoría
function elegirPublicacionSubasta() {
    const ofertaId = document.getElementById('subastaOferta').value;
    const categoria = document.getElementById('subastaCategoria');
    const oferta = misPublicaciones.find(o => String(o.OfertaID) === ofertaId);
    categoria.disabled = !!oferta;
    if (!oferta) return;
    document.getElementById('subastaTitulo').value = oferta.TituloMaterial;
    document.getElementById('subastaPrecioBase').value = parseFloat(oferta.Precio);
    categoria.value = String(oferta.CategoriaID);
}

function abrirModal() {
    document.getElementById('modalOferta').style.display = 'block';
    setTimeout(() => document.getElementById('ofertaTitulo').focus(), 50);
}

// EDITAR una publicación: el mismo formulario, con sus datos y fotos actuales
function abrirModalEdicion(ofertaId) {
    const oferta = todasLasOfertas.find(o => Number(o.OfertaID) === ofertaId);
    if (!oferta) return;
    cerrarModal();
    ofertaEditando = ofertaId;
    fotosExistentes = Array.isArray(oferta.Fotos) ? [...oferta.Fotos] : [];
    fotosQuitar = [];
    document.getElementById('ofertaTitulo').value = oferta.TituloMaterial;
    document.getElementById('ofertaDescripcion').value = oferta.Descripcion || '';
    contarDescripcion();
    document.getElementById('ofertaPrecio').value = parseFloat(oferta.Precio);
    document.getElementById('ofertaUnidad').value = oferta.UnidadMedida;
    document.getElementById('ofertaDistancia').value = Number(oferta.DistanciaSimuladaKm) || 0;
    document.getElementById('ofertaCategoria').value = String(oferta.CategoriaID);
    document.getElementById('tituloModalOferta').textContent = 'Editar publicación';
    document.getElementById('btnGuardarOferta').innerHTML = 'Guardar cambios <i class="ti ti-device-floppy"></i>';
    renderizarVistaPreviaFotos();
    abrirModal();
}

function cerrarModal() {
    document.getElementById('modalOferta').style.display = 'none';
    document.getElementById('ofertaTitulo').value = '';
    document.getElementById('ofertaDescripcion').value = '';
    contarDescripcion();
    mostrarResultadoIA('');
    document.getElementById('ofertaPrecio').value = '';
    document.getElementById('ofertaUnidad').value = '';
    document.getElementById('ofertaDistancia').value = '';
    document.getElementById('ofertaCategoria').selectedIndex = 0;
    fotosPublicacion.forEach(f => URL.revokeObjectURL(f.url));
    fotosPublicacion = [];
    ofertaEditando = null;
    fotosExistentes = [];
    fotosQuitar = [];
    document.getElementById('tituloModalOferta').textContent = 'Publicar Oferta Directa';
    document.getElementById('btnGuardarOferta').innerHTML = 'Guardar y Publicar Oferta ↗';
    renderizarVistaPreviaFotos();
}

async function abrirModalSubasta() {
    // Lista de MIS publicaciones (todas, no solo las de la página que se ve), por si el lote sale de una de ellas
    const miUserId = String(localStorage.getItem('userId'));
    const select = document.getElementById('subastaOferta');
    select.innerHTML = '<option value="">No, es un lote nuevo</option>';
    document.getElementById('modalSubasta').style.display = 'block';
    try {
        const res = await fetch(`${API_URL}/api/ofertas?proveedorId=${encodeURIComponent(miUserId)}`);
        misPublicaciones = res.ok ? await res.json() : [];
    } catch (e) {
        misPublicaciones = [];
    }
    misPublicaciones.forEach(o => select.add(new Option(`${o.TituloMaterial} · C$ ${parseFloat(o.Precio).toFixed(2)}`, String(o.OfertaID))));
}

function cerrarModalSubasta() {
    document.getElementById('modalSubasta').style.display = 'none';
    document.getElementById('subastaTitulo').value = '';
    document.getElementById('subastaPrecioBase').value = '';
    document.getElementById('subastaOferta').value = '';
    document.getElementById('subastaDias').value = '7';
    document.getElementById('subastaCategoria').disabled = false;
    document.getElementById('subastaCategoria').selectedIndex = 0;
}

// ------------------------------------------------------------ ASISTENTE DE IA
function contarDescripcion() {
    const largo = document.getElementById('ofertaDescripcion').value.length;
    document.getElementById('contadorDescripcion').textContent = `${largo} / 1000`;
}

// html vacío oculta la caja; los textos que vienen del servidor se escapan antes de llegar aquí
function mostrarResultadoIA(html, esError = false) {
    const caja = document.getElementById('resultadoIA');
    caja.hidden = !html;
    caja.classList.toggle('error', esError);
    caja.innerHTML = html;
}

async function conBotonOcupado(idBoton, texto, tarea) {
    const boton = document.getElementById(idBoton);
    const original = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = `<i class="ti ti-loader-2" aria-hidden="true"></i> ${texto}`;
    try { return await tarea(); } finally { boton.disabled = false; boton.innerHTML = original; }
}

// Foto para la IA: la primera que se agregó o, al editar, la primera que ya tenía la publicación
async function primeraFotoParaIA() {
    if (fotosPublicacion.length) return fotosPublicacion[0].blob;
    const existente = fotosExistentesVisibles()[0];
    if (!existente) return null;
    try {
        const res = await fetch(existente);
        return res.ok ? await res.blob() : null;
    } catch (e) { return null; }
}

async function completarConIA() {
    const titulo = document.getElementById('ofertaTitulo').value.trim();
    await conBotonOcupado('btnIaDescribir', 'Analizando…', async () => {
        const foto = await primeraFotoParaIA();
        if (!foto && !titulo) {
            mostrarResultadoIA('Primero sube una foto del material o escribe el título.', true);
            return;
        }
        const formulario = new FormData();
        if (foto) formulario.append('fotos', foto, `foto.${foto.type === 'image/webp' ? 'webp' : foto.type === 'image/png' ? 'png' : 'jpg'}`);
        if (titulo) formulario.append('titulo', titulo);
        mostrarResultadoIA('<i class="ti ti-sparkles"></i> La IA está mirando tu material…');
        try {
            const res = await fetch(`${API_URL}/api/ia/publicacion`, { method: 'POST', body: formulario });
            const r = await res.json().catch(() => ({}));
            if (!res.ok) return mostrarResultadoIA(esc(r.message || 'La IA no pudo ayudarte esta vez.'), true);
            if (r.titulo) document.getElementById('ofertaTitulo').value = r.titulo;
            if (r.descripcion) { document.getElementById('ofertaDescripcion').value = r.descripcion; contarDescripcion(); }
            if (r.unidad) document.getElementById('ofertaUnidad').value = r.unidad;
            if (r.categoriaId) document.getElementById('ofertaCategoria').value = String(r.categoriaId);
            mostrarResultadoIA(`<strong><i class="ti ti-check"></i> Listo.</strong> Llené el título, la descripción, la unidad${r.categoria ? ` y la categoría (${esc(r.categoria)})` : ''}. Revísalos y cambia lo que haga falta antes de publicar.`);
        } catch (e) {
            mostrarResultadoIA('Error al conectar con el servidor.', true);
        }
    });
}

async function sugerirPrecioIA() {
    const categoriaId = document.getElementById('ofertaCategoria').value;
    if (!categoriaId) {
        mostrarResultadoIA('Elige primero la categoría del material para comparar con publicaciones parecidas.', true);
        return;
    }
    await conBotonOcupado('btnIaPrecio', 'Comparando…', async () => {
        try {
            const res = await fetch(`${API_URL}/api/ia/precio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    titulo: document.getElementById('ofertaTitulo').value.trim(),
                    categoriaId: Number(categoriaId),
                    unidad: document.getElementById('ofertaUnidad').value.trim(),
                    ofertaId: ofertaEditando
                })
            });
            const r = await res.json().catch(() => ({}));
            if (!res.ok) return mostrarResultadoIA(esc(r.message || 'No se pudo calcular un precio.'), true);
            if (!r.sugerido) return mostrarResultadoIA(esc(r.explicacion));
            const rango = r.rango ? `<br><small>Rango en la plataforma: C$ ${r.rango.minimo.toFixed(2)} – C$ ${r.rango.maximo.toFixed(2)} (${r.muestras} precio${r.muestras === 1 ? '' : 's'})</small>` : '';
            mostrarResultadoIA(`
                <strong><i class="ti ti-coin"></i> Precio sugerido: C$ ${Number(r.sugerido).toFixed(2)}</strong>
                ${r.fuente === 'ia' ? '<span class="badge badge-mat" style="margin-left:4px;">IA</span>' : ''}<br>
                ${esc(r.explicacion)}${rango}<br>
                <button type="button" class="btn-sm cta" onclick="usarPrecioSugerido(${Number(r.sugerido)})">Usar C$ ${Number(r.sugerido).toFixed(2)}</button>`);
        } catch (e) {
            mostrarResultadoIA('Error al conectar con el servidor.', true);
        }
    });
}

function usarPrecioSugerido(precio) {
    const campo = document.getElementById('ofertaPrecio');
    campo.value = precio;
    campo.focus();
}
