/* ==========================================================================
   CATEGORÍAS DE MATERIALES
   Se leen de la base de datos (GET /api/categorias) en lugar de estar escritas
   a mano en cada página: si el administrador crea una categoría nueva, aparece
   sola en los formularios y en el buscador.
   Uso:
     const lista = await Categorias.cargar();
     Categorias.llenarSelect(select, lista, { primera: { valor: 'todos', texto: 'Todos los insumos' } });
     const id = Categorias.buscarPorTexto(lista, 'Cuero Vacuno');   // para enlaces viejos ?categoria=texto
   ========================================================================== */
(function () {
    let pendiente = null;

    // Una sola petición por página aunque varias partes la pidan
    function cargar() {
        if (!pendiente) {
            pendiente = fetch('/api/categorias')
                .then(res => (res.ok ? res.json() : []))
                .then(lista => (Array.isArray(lista) ? lista : []))
                .catch(() => []);
        }
        return pendiente;
    }

    // Se crean los <option> con textContent: un nombre con < o " no rompe la página
    function llenarSelect(select, lista, { primera = null, seleccionada = null } = {}) {
        if (!select) return;
        const valorAnterior = seleccionada !== null ? String(seleccionada) : select.value;
        select.innerHTML = '';
        if (primera) {
            const opcion = new Option(primera.texto, primera.valor);
            if (primera.deshabilitada) { opcion.disabled = true; opcion.selected = true; }
            select.add(opcion);
        }
        lista.forEach(c => select.add(new Option(c.NombreCategoria, String(c.CategoriaID))));
        if (!lista.length) {
            const aviso = new Option('No se pudieron cargar las categorías', '');
            aviso.disabled = true;
            select.add(aviso);
        }
        if (valorAnterior && [...select.options].some(o => o.value === valorAnterior)) select.value = valorAnterior;
    }

    const limpiar = (texto) => String(texto || '')
        .toLowerCase()
        .replace(/&/g, 'y')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim();

    // Devuelve el CategoriaID cuyo nombre comparte más palabras con el texto (o null).
    // Ej.: "Cuero Vacuno" → "Cuero Bovino / Vacuno"; "Herrajes" → "Herrajes, Hebillas y Mosquetones"
    function buscarPorTexto(lista, texto) {
        const palabras = limpiar(texto).split(/[^a-z0-9]+/).filter(p => p.length > 3);
        let mejor = null, puntos = 0;
        for (const c of lista) {
            const nombre = limpiar(c.NombreCategoria);
            const coincidencias = palabras.filter(p => nombre.includes(p)).length;
            if (coincidencias > puntos) { mejor = c.CategoriaID; puntos = coincidencias; }
        }
        return mejor;
    }

    window.Categorias = { cargar, llenarSelect, buscarPorTexto };
})();
