// ==========================================================================
// DEPARTAMENTOS DE NICARAGUA Y SUS COORDENADAS (para el mapa de proveedores)
//
// Al registrarse cada persona ESCRIBE su departamento ("Managua", "leon",
// "Estelí "...), así que aquí se reconoce el nombre sin importar mayúsculas,
// tildes ni espacios, y también algunos nombres alternativos (cabeceras y
// nombres antiguos de las regiones del Caribe).
// Las coordenadas son las de la cabecera departamental.
// ==========================================================================

const DEPARTAMENTOS = [
    { nombre: 'Boaco', lat: 12.4722, lng: -85.6586 },
    { nombre: 'Carazo', lat: 11.8500, lng: -86.2000, otros: ['jinotepe'] },
    { nombre: 'Chinandega', lat: 12.6294, lng: -87.1311 },
    { nombre: 'Chontales', lat: 12.1056, lng: -85.3645, otros: ['juigalpa'] },
    { nombre: 'Estelí', lat: 13.0919, lng: -86.3538 },
    { nombre: 'Granada', lat: 11.9299, lng: -85.9560 },
    { nombre: 'Jinotega', lat: 13.0910, lng: -86.0023 },
    { nombre: 'León', lat: 12.4379, lng: -86.8780 },
    { nombre: 'Madriz', lat: 13.4810, lng: -86.5830, otros: ['somoto'] },
    { nombre: 'Managua', lat: 12.1364, lng: -86.2514, otros: ['ciudad sandino', 'tipitapa'] },
    { nombre: 'Masaya', lat: 11.9744, lng: -86.0942 },
    { nombre: 'Matagalpa', lat: 12.9256, lng: -85.9175 },
    { nombre: 'Nueva Segovia', lat: 13.6318, lng: -86.4752, otros: ['ocotal'] },
    { nombre: 'Río San Juan', lat: 11.1236, lng: -84.7783, otros: ['san carlos'] },
    { nombre: 'Rivas', lat: 11.4372, lng: -85.8264 },
    {
        nombre: 'Costa Caribe Norte', lat: 14.0300, lng: -83.3833,
        otros: ['raccn', 'raan', 'region autonoma de la costa caribe norte', 'region autonoma del atlantico norte',
            'caribe norte', 'atlantico norte', 'bilwi', 'puerto cabezas']
    },
    {
        nombre: 'Costa Caribe Sur', lat: 12.0137, lng: -83.7635,
        otros: ['raccs', 'raas', 'region autonoma de la costa caribe sur', 'region autonoma del atlantico sur',
            'caribe sur', 'atlantico sur', 'bluefields']
    }
];

// "  Estelí " -> "esteli"; "Río  San Juan" -> "rio san juan"
const normalizarNombre = (texto) => String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const PORNOMBRE = new Map();
for (const d of DEPARTAMENTOS) {
    PORNOMBRE.set(normalizarNombre(d.nombre), d);
    for (const otro of d.otros || []) PORNOMBRE.set(normalizarNombre(otro), d);
}

// Devuelve { nombre, lat, lng } del departamento escrito, o null si no se reconoce.
// También acepta "Departamento de León" o "Managua, Nicaragua".
function ubicarDepartamento(texto) {
    let limpio = normalizarNombre(texto).replace(/^(departamento|depto|dpto) (de )?/, '').replace(/ nicaragua$/, '').trim();
    const encontrado = PORNOMBRE.get(limpio);
    if (encontrado) return { nombre: encontrado.nombre, lat: encontrado.lat, lng: encontrado.lng };
    // "Managua centro", "León (Sutiaba)": se prueba con la primera palabra o las dos primeras
    const palabras = limpio.split(' ');
    for (const n of [2, 1]) {
        const d = PORNOMBRE.get(palabras.slice(0, n).join(' '));
        if (d && palabras.length > n) return { nombre: d.nombre, lat: d.lat, lng: d.lng };
    }
    return null;
}

module.exports = { DEPARTAMENTOS, ubicarDepartamento, normalizarNombre };
