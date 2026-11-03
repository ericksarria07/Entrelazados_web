// Carga datos de DEMOSTRACIÓN en la base local de pruebas (entrelazados_pruebas)
// para ver el dashboard con actividad realista de varios meses.
// Uso (desde la carpeta backend, con la base recién creada por cargar_esquema.js):
//   node pruebas/datos_demo.js "$(pwd)" CLAVE_DE_PRUEBA
// Todas las cuentas demo usan la contraseña: Demo1234
const [, , backend, dbPass] = process.argv;
const mysql = require(backend + '/node_modules/mysql2/promise');
const bcrypt = require(backend + '/node_modules/bcrypt');

// Generador pseudoaleatorio con semilla: siempre produce los mismos datos
let semilla = 20261101;
const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const entre = (a, b) => Math.floor(azar() * (b - a + 1)) + a;
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
const haceDias = (d, horas = 0) => new Date(Date.now() - d * 86400000 - horas * 3600000);

const DEPARTAMENTOS = ['Managua', 'León', 'Masaya', 'Granada', 'Estelí', 'Chinandega', 'Matagalpa', 'Carazo'];
const PROVEEDORES = ['Curtiembre San Jacinto', 'Cueros del Pacífico', 'Tenería La Fe', 'Suelas Nicas', 'Herrajes Momotombo',
    'Insumos El Volcán', 'Pieles Selectas Masaya', 'Textiles Xolotlán', 'Cueros Finos Estelí', 'Distribuidora El Gueguense'];
const EMPRENDEDORES = ['Zapatería Doña Rosa', 'Calzado Artesanal Monimbó', 'Botas El Rancho', 'Taller Hermanos López',
    'Sandalias del Lago', 'Marroquinería Ometepe', 'Bolsos Chontales', 'Calzado Escolar Mi Niño', 'Huaraches Masatepe',
    'Taller El Buen Paso', 'Cinturones El Vaquero', 'Calzado Fino Granada', 'Mochilas Estelí', 'Zapatos Pinolero',
    'Botines La Pradera', 'Artesanías San Juan', 'Calzado Deportivo Nica', 'Taller La Herradura'];
const MATERIALES = [
    [1, 'Cuero vacuno curtido al vegetal', 'pie²', 85, 140], [1, 'Cuero vacuno flor entera', 'pie²', 110, 180],
    [2, 'Cuero de cabra para forro', 'pie²', 70, 120], [3, 'Gamuza café para botín', 'pie²', 60, 100],
    [4, 'Charol negro brillante', 'metro', 220, 320], [5, 'Forro textil antideslizante', 'metro', 45, 80],
    [6, 'Hebillas metálicas doradas', 'docena', 90, 160], [7, 'Remaches de cobre', 'ciento', 40, 75],
    [8, 'Cierres YKK de 20 cm', 'docena', 120, 190], [9, 'Hilo encerado 1 mm', 'rollo', 150, 260],
    [10, 'Pegamento de contacto', 'galón', 380, 520], [11, 'Tinte para cantos', 'litro', 210, 300],
    [13, 'Suela de hule antiderrapante', 'par', 55, 95], [13, 'Tacón de madera', 'par', 70, 130],
    [14, 'Plantilla de armado', 'par', 25, 45], [15, 'Espuma EVA 5 mm', 'lámina', 140, 230]
];

(async () => {
    const db = await mysql.createConnection({ host: process.env.PRUEBAS_DB_HOST || 'localhost', user: 'entrelazados_pruebas', password: dbPass, database: 'entrelazados_pruebas' });
    const q = async (sql, p = []) => (await db.query(sql, p))[0];
    const hash = bcrypt.hashSync('Demo1234', 10);

    const deptoId = {};
    for (const d of DEPARTAMENTOS) {
        await q('INSERT IGNORE INTO Departamentos (NombreDepartamento) VALUES (?)', [d]);
        deptoId[d] = (await q('SELECT DepartamentoID FROM Departamentos WHERE NombreDepartamento = ?', [d]))[0].DepartamentoID;
    }

    async function crearUsuario(nombre, rol, i) {
        const correo = `${rol.toLowerCase()}${i + 1}@demo.com`;
        const registro = haceDias(entre(5, 235), entre(0, 20));
        const depto = rol === 'Proveedor' ? elegir(DEPARTAMENTOS.slice(0, 5)) : elegir(DEPARTAMENTOS);
        const r = await q('INSERT INTO Usuarios (CorreoElectronico, ContrasenaHash, TipoRol, FechaRegistro) VALUES (?, ?, ?, ?)', [correo, hash, rol, registro]);
        await q('INSERT INTO PerfilesUsuarios (UsuarioID, NombreRazonSocial, TelefonoWhatsApp, DepartamentoID) VALUES (?, ?, ?, ?)',
            [r.insertId, nombre, `8${entre(1000000, 9999999)}`, deptoId[depto]]);
        if (rol === 'Proveedor') await q('INSERT INTO Proveedores (UsuarioID, NombreComercial) VALUES (?, ?)', [r.insertId, nombre]);
        else await q('INSERT INTO Emprendedores (UsuarioID, NombreMarca, CapacidadProduccionMensual) VALUES (?, ?, ?)', [r.insertId, nombre, entre(50, 600)]);
        return { id: r.insertId, registro };
    }

    const proveedores = [];
    for (const [i, n] of PROVEEDORES.entries()) proveedores.push(await crearUsuario(n, 'Proveedor', i));
    const emprendedores = [];
    for (const [i, n] of EMPRENDEDORES.entries()) emprendedores.push(await crearUsuario(n, 'Emprendedor', i));

    let ofertas = 0, subastas = 0, pujas = 0, mensajes = 0;
    for (let k = 0; k < 42; k++) {
        const prov = elegir(proveedores);
        const [cat, titulo, unidad, pmin, pmax] = elegir(MATERIALES);
        const diasDesdeRegistro = Math.floor((Date.now() - prov.registro) / 86400000);
        const publicado = haceDias(entre(0, Math.max(1, diasDesdeRegistro)), entre(0, 20));
        const precio = entre(pmin, pmax);
        const oferta = await q('INSERT INTO Ofertas (ProveedorID, TituloMaterial, CategoriaID, Precio, UnidadMedida, DistanciaSimuladaKm, Fotos, FechaPublicacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [prov.id, titulo, cat, precio, unidad, entre(2, 45), '[]', publicado]);
        ofertas++;

        // Cada oferta crea su subasta de 7 días (como en la plataforma real)
        const fin = new Date(publicado.getTime() + 7 * 86400000);
        const activa = fin > new Date();
        const s = await q('INSERT INTO Subastas (ProveedorID, OfertaID, CategoriaID, TituloLote, PrecioBase, PrecioActual, FechaInicio, FechaFin, Estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [prov.id, oferta.insertId, cat, `Lote Subasta: ${titulo}`, precio, precio, publicado, fin, activa ? 'Activa' : 'Finalizada']);
        subastas++;

        let actual = precio;
        const nPujas = entre(0, 7);
        const limite = Math.min(Date.now(), fin.getTime());
        for (let j = 0; j < nPujas; j++) {
            actual = Math.round((actual + entre(3, 25)) * 100) / 100;
            const fecha = new Date(publicado.getTime() + (limite - publicado.getTime()) * ((j + 1) / (nPujas + 1)));
            await q('INSERT INTO Pujas (SubastaID, EmprendedorID, MontoPuja, FechaPuja) VALUES (?, ?, ?, ?)', [s.insertId, elegir(emprendedores).id, actual, fecha]);
            pujas++;
        }
        await q('UPDATE Subastas SET PrecioActual = ? WHERE SubastaID = ?', [actual, s.insertId]);
    }

    const frases = ['Buenas, ¿tiene disponible este material?', '¿Hacen envíos a mi departamento?', 'Me interesa un pedido de 50 unidades.',
        'Sí, tenemos en existencia.', '¿Cuál es el precio por mayor?', 'Puedo entregarle el viernes.'];
    for (let k = 0; k < 60; k++) {
        const e = elegir(emprendedores), p = elegir(proveedores);
        const [de, para] = azar() < 0.5 ? [e.id, p.id] : [p.id, e.id];
        await q('INSERT INTO MensajesChat (RemitenteID, DestinatarioID, ContenidoTexto, FechaEnvio) VALUES (?, ?, ?, ?)',
            [de, para, elegir(frases), haceDias(entre(0, 200), entre(0, 20))]);
        mensajes++;
    }

    await db.end();
    console.log(`Datos demo: ${proveedores.length} proveedores, ${emprendedores.length} emprendedores, ${ofertas} ofertas, ${subastas} subastas, ${pujas} pujas, ${mensajes} mensajes.`);
    console.log('Cuentas: proveedor1@demo.com ... / emprendedor1@demo.com ...  (contraseña: Demo1234)');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
