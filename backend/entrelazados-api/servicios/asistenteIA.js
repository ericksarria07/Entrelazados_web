// ==========================================================================
// ASISTENTE DE IA PARA PUBLICAR (Gemini)
//
// Ayuda al proveedor a llenar el formulario de una publicación:
//
// 1. describirPublicacion: a partir de una foto del material (y/o lo que ya
//    escribió) propone título, descripción, categoría y unidad de medida.
//    Necesita Gemini: si no está configurado o falla, responde 503 con un
//    mensaje claro y el proveedor sigue llenando el formulario a mano.
//
// 2. sugerirPrecio: busca publicaciones parecidas (misma categoría, y si se
//    puede, la misma unidad) y los tratos cerrados de esa categoría, y calcula
//    el rango de precios. Gemini propone un precio dentro de ese rango y explica
//    por qué; si Gemini no responde, se sugiere la mediana. Así esta parte
//    funciona SIEMPRE, con o sin IA.
//
// La IA nunca guarda nada: solo propone, y el proveedor decide.
// ==========================================================================
const { GoogleGenAI } = require('@google/genai');
const { ErrorHttp, enteroPositivo, textoLimpio } = require('../utilidades');
const { LARGO_DESCRIPCION } = require('./ofertas');

const NO_DISPONIBLE = 'El asistente de IA no está disponible en este momento. Puedes llenar el formulario a mano.';
const MAX_COMPARABLES = 25;

// "por pie²", "Pie2", "pies cuadrados" -> "pie2" (para comparar solo precios de la misma unidad)
function normalizarUnidad(texto) {
    const t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/²/g, '2').replace(/\bc\/u\b/g, 'unidad').replace(/\bpor\b|\bcada\b|\bla\b|\bel\b|\bun[ao]?\b/g, ' ')
        .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^pies? ?(2|cuadrados?)$/.test(t)) return 'pie2';
    if (/^(m|metros?) ?(2|cuadrados?)$/.test(t)) return 'm2';
    if (/^(m|metros?)( lineal(es)?)?$/.test(t)) return 'm';
    if (/^pares?$/.test(t)) return 'par';
    if (/^docenas?$/.test(t)) return 'docena';
    if (/^(unidad(es)?|u|pieza(s)?)$/.test(t)) return 'unidad';
    if (/^(kg|kilos?|kilogramos?)$/.test(t)) return 'kg';
    if (/^(lb|libras?)$/.test(t)) return 'lb';
    if (/^(galon(es)?|gal)$/.test(t)) return 'galon';
    if (/^(rollos?)$/.test(t)) return 'rollo';
    return t.replace(/s$/, '');
}

// Mínimo, máximo, promedio y mediana de una lista de precios (null si está vacía)
function estadisticas(precios) {
    const lista = precios.map(Number).filter(n => n > 0).sort((a, b) => a - b);
    if (lista.length === 0) return null;
    const mitad = Math.floor(lista.length / 2);
    const mediana = lista.length % 2 ? lista[mitad] : (lista[mitad - 1] + lista[mitad]) / 2;
    const redondear = (n) => Math.round(n * 100) / 100;
    return {
        muestras: lista.length,
        minimo: lista[0],
        maximo: lista[lista.length - 1],
        promedio: redondear(lista.reduce((s, n) => s + n, 0) / lista.length),
        mediana: redondear(mediana)
    };
}

// Un precio propuesto por la IA solo se acepta si es razonable respecto a las publicaciones parecidas
function precioRazonable(precio, est) {
    const n = Number(precio);
    if (!(n > 0)) return false;
    if (!est) return n < 99999999;
    return n >= est.minimo * 0.5 && n <= est.maximo * 1.5;
}

// Redondeo "de tienda": hasta C$100 a 1 córdoba, hasta C$1000 a 5, más arriba a 10
function redondearPrecio(n) {
    const paso = n < 100 ? 1 : n < 1000 ? 5 : 10;
    return Math.max(paso, Math.round(n / paso) * paso);
}

function crearAsistenteIA({ db, clave, modelo }) {
    const configurado = Boolean(clave);
    let ai = null;
    if (configurado) {
        try { ai = new GoogleGenAI({ apiKey: clave }); } catch (err) { console.error('⚠️ Asistente de IA sin iniciar:', err.message); }
    }

    // Llama a Gemini pidiendo una respuesta JSON con el esquema indicado
    async function preguntarJson({ partes, esquema, temperatura = 0.4 }) {
        if (!ai) throw new ErrorHttp(503, NO_DISPONIBLE);
        try {
            const respuesta = await ai.models.generateContent({
                model: modelo,
                contents: [{ role: 'user', parts: partes }],
                config: {
                    temperature: temperatura,
                    maxOutputTokens: 800,
                    responseMimeType: 'application/json',
                    responseJsonSchema: esquema
                }
            });
            return JSON.parse(respuesta.text || '{}');
        } catch (err) {
            console.error('❌ Asistente de IA (Gemini):', err.message || err);
            throw new ErrorHttp(503, NO_DISPONIBLE);
        }
    }

    // foto: { buffer, mimetype } o null. titulo: lo que ya escribió el proveedor (opcional).
    async function describirPublicacion({ foto = null, titulo = '' }) {
        const tituloActual = textoLimpio(titulo).slice(0, 120);
        if (!foto && !tituloActual) throw new ErrorHttp(400, 'Sube una foto del material o escribe al menos el título.');
        const [categorias] = await db.query('SELECT CategoriaID, NombreCategoria FROM CategoriasMateriales ORDER BY CategoriaID');

        const instrucciones = `Eres el asistente de EntreLazados, un mercado de Nicaragua donde proveedores venden materia prima
para calzado y marroquinería (cuero, suelas, herrajes, hilos, pegamentos...) a talleres y emprendedores.
Ayuda a un proveedor a publicar un material. ${foto ? 'Mira la foto del material.' : ''}
${tituloActual ? `El proveedor ya escribió este título: "${tituloActual}".` : ''}
Responde en español de Nicaragua, sin inventar datos que no se vean o no se digan (no inventes medidas, marcas ni cantidades).
- titulo: corto y concreto (máximo 80 caracteres), p. ej. "Cuero vacuno curtido café, 1.8 mm".
- descripcion: 2 a 4 oraciones útiles para un comprador: material, color, acabado, usos recomendados en calzado o marroquinería. Máximo 500 caracteres.
- categoriaId: el número de la categoría que mejor corresponde de esta lista:
${categorias.map(c => `  ${c.CategoriaID} = ${c.NombreCategoria}`).join('\n')}
- unidad: la unidad de venta más común para ese material, p. ej. "por pie²", "por par", "por docena", "por metro", "por unidad".
- esMaterial: false si la foto no muestra un material o insumo para calzado o marroquinería.`;

        const partes = [{ text: instrucciones }];
        if (foto) partes.unshift({ inlineData: { mimeType: foto.mimetype, data: foto.buffer.toString('base64') } });
        const r = await preguntarJson({
            partes,
            esquema: {
                type: 'object',
                properties: {
                    titulo: { type: 'string' },
                    descripcion: { type: 'string' },
                    categoriaId: { type: 'integer' },
                    unidad: { type: 'string' },
                    esMaterial: { type: 'boolean' }
                },
                required: ['titulo', 'descripcion', 'categoriaId', 'unidad', 'esMaterial']
            }
        });

        if (r.esMaterial === false) {
            throw new ErrorHttp(422, 'La foto no parece mostrar un material para calzado o marroquinería. Prueba con otra foto.');
        }
        const categoria = categorias.find(c => c.CategoriaID === enteroPositivo(r.categoriaId)) || null;
        return {
            titulo: textoLimpio(r.titulo).slice(0, 120) || tituloActual,
            descripcion: textoLimpio(r.descripcion).slice(0, LARGO_DESCRIPCION),
            categoriaId: categoria ? categoria.CategoriaID : null,
            categoria: categoria ? categoria.NombreCategoria : null,
            unidad: textoLimpio(r.unidad).slice(0, 30)
        };
    }

    // Publicaciones y tratos parecidos para comparar precios
    async function buscarComparables({ categoriaId, unidad, excluirOfertaId }) {
        const [ofertas] = await db.query(
            `SELECT OfertaID, TituloMaterial, Precio, UnidadMedida FROM Ofertas
             WHERE CategoriaID = ? AND OfertaID <> ? ORDER BY FechaPublicacion DESC LIMIT 200`,
            [categoriaId, excluirOfertaId || 0]);
        const [tratos] = await db.query(
            `SELECT t.MontoTotal, s.TituloLote, o.UnidadMedida
             FROM TratosCerrados t
             JOIN Subastas s ON t.TipoOrigen = 'Subasta' AND s.SubastaID = t.OrigenID
             JOIN Ofertas o ON o.OfertaID = s.OfertaID
             WHERE s.CategoriaID = ? AND t.EstadoTrato <> 'Cancelado'
             ORDER BY t.FechaCierre DESC LIMIT 50`, [categoriaId]);

        const miUnidad = normalizarUnidad(unidad);
        const todos = [
            ...ofertas.map(o => ({ titulo: o.TituloMaterial, precio: Number(o.Precio), unidad: o.UnidadMedida, fuente: 'publicación' })),
            // Un trato solo sirve si su subasta salió de una publicación (así se sabe la unidad de su precio)
            ...tratos.filter(t => t.UnidadMedida).map(t => ({ titulo: String(t.TituloLote).replace(/^Lote Subasta:\s*/i, ''), precio: Number(t.MontoTotal), unidad: t.UnidadMedida, fuente: 'subasta cerrada' }))
        ];
        const mismaUnidad = miUnidad ? todos.filter(c => c.unidad && normalizarUnidad(c.unidad) === miUnidad) : [];
        // Con al menos 2 precios de la misma unidad se usan solo esos; si no, toda la categoría (con aviso)
        const usarMismaUnidad = mismaUnidad.length >= 2;
        return { comparables: (usarMismaUnidad ? mismaUnidad : todos).slice(0, 200), mismaUnidad: usarMismaUnidad };
    }

    // { titulo, categoriaId, unidad, ofertaId? } -> { sugerido, rango, explicacion, fuente, ... }
    async function sugerirPrecio({ titulo, categoriaId, unidad, ofertaId }) {
        const categoria = enteroPositivo(categoriaId);
        if (!categoria) throw new ErrorHttp(400, 'Elige la categoría del material para comparar precios.');
        const [[cat]] = await db.query('SELECT NombreCategoria FROM CategoriasMateriales WHERE CategoriaID = ?', [categoria]);
        if (!cat) throw new ErrorHttp(400, 'La categoría elegida no existe.');
        const tituloLimpio = textoLimpio(titulo).slice(0, 120);
        const unidadLimpia = textoLimpio(unidad).slice(0, 30);

        const { comparables, mismaUnidad } = await buscarComparables({ categoriaId: categoria, unidad: unidadLimpia, excluirOfertaId: enteroPositivo(ofertaId) });
        const est = estadisticas(comparables.map(c => c.precio));
        const base = {
            categoria: cat.NombreCategoria,
            muestras: est ? est.muestras : 0,
            rango: est ? { minimo: est.minimo, maximo: est.maximo, promedio: est.promedio, mediana: est.mediana } : null,
            mismaUnidad,
            ejemplos: comparables.slice(0, 5).map(c => ({ titulo: c.titulo, precio: c.precio, unidad: c.unidad, fuente: c.fuente }))
        };

        if (!est) {
            return {
                ...base, sugerido: null, fuente: 'sin-datos',
                explicacion: `Todavía no hay publicaciones de ${cat.NombreCategoria} para comparar. Pon el precio al que vendes normalmente; cuando haya más publicaciones podremos sugerirte uno.`
            };
        }

        const avisoUnidad = mismaUnidad ? '' : ' Ojo: algunas publicaciones usan otra unidad de medida, así que tómalo como referencia.';
        const respaldo = {
            ...base,
            sugerido: redondearPrecio(est.mediana),
            fuente: 'estadistica',
            explicacion: `En ${cat.NombreCategoria} hay ${est.muestras} precio${est.muestras === 1 ? '' : 's'} para comparar, entre C$${est.minimo} y C$${est.maximo}. ` +
                `Te sugerimos el precio del medio (la mediana).${avisoUnidad}`
        };
        if (!ai) return respaldo;

        try {
            const lista = comparables.slice(0, MAX_COMPARABLES)
                .map(c => `- ${c.titulo}: C$${c.precio}${c.unidad ? ` ${c.unidad}` : ''} (${c.fuente})`).join('\n');
            const r = await preguntarJson({
                temperatura: 0.2,
                partes: [{
                    text: `Eres el asistente de precios de EntreLazados (Nicaragua, precios en córdobas C$).
Un proveedor quiere publicar: "${tituloLimpio || 'material sin título'}" en la categoría ${cat.NombreCategoria}${unidadLimpia ? `, vendido ${unidadLimpia}` : ''}.
Precios de materiales parecidos en la plataforma (mediana C$${est.mediana}, mínimo C$${est.minimo}, máximo C$${est.maximo}):
${lista}
Propón un precio competitivo DENTRO de ese rango para que se venda pronto sin regalar el material,
y explica en 1 o 2 oraciones sencillas por qué (menciona con qué publicaciones lo comparaste). No inventes otros datos.${mismaUnidad ? '' : ' Algunas publicaciones usan otra unidad: dilo en la explicación.'}`
                }],
                esquema: {
                    type: 'object',
                    properties: { precioSugerido: { type: 'number' }, explicacion: { type: 'string' } },
                    required: ['precioSugerido', 'explicacion']
                }
            });
            if (!precioRazonable(r.precioSugerido, est) || !textoLimpio(r.explicacion)) return respaldo;
            return { ...base, sugerido: redondearPrecio(Number(r.precioSugerido)), fuente: 'ia', explicacion: textoLimpio(r.explicacion).slice(0, 500) };
        } catch (err) {
            return respaldo;   // sin IA, la sugerencia por estadística sigue sirviendo
        }
    }

    return { configurado, describirPublicacion, sugerirPrecio };
}

module.exports = { crearAsistenteIA, normalizarUnidad, estadisticas, precioRazonable, redondearPrecio, NO_DISPONIBLE };
