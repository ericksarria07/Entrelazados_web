// ==========================================================================
// PRUEBA DE PUNTA A PUNTA DE NEON
//
//   npm run probar:neon
//
// Usa la conexión con pooler (DATABASE_URL), la misma que usará la aplicación,
// y comprueba lo que la migración necesita de Postgres:
//   1. conexión y versión
//   2. las 18 tablas del esquema
//   3. INSERT ... RETURNING (reemplazo de insertId)
//   4. pujas simultáneas con SELECT ... FOR UPDATE: la segunda espera a la
//      primera y se rechaza si ya no supera el precio (validación atómica)
//   5. búsqueda sin acentos ni mayúsculas (unaccent + ILIKE)
//   6. COUNT(*) llega como texto; con ::int llega como número
//   7. el trigger que reemplaza a ON UPDATE CURRENT_TIMESTAMP
// Los datos de prueba se borran al final, pase lo que pase.
// ==========================================================================
const { crearPool } = require('./neon_comun');

const pool = crearPool('DATABASE_URL');
const marca = `prueba-neon-${Date.now()}`;
let fallos = 0;

function ok(condicion, texto, detalle = '') {
    if (!condicion) fallos++;
    console.log(`${condicion ? '✔' : '✖'} ${texto}${detalle ? `  (${detalle})` : ''}`);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Puja como la hará la aplicación: bloquea la fila de la subasta, valida y actualiza
async function pujar(subastaId, emprendedorId, monto, retenerMs = 0) {
    const client = await pool.connect();
    const inicio = Date.now();
    try {
        await client.query('BEGIN');
        const { rows: [subasta] } = await client.query(
            'SELECT precio_actual, estado FROM subastas WHERE subasta_id = $1 FOR UPDATE', [subastaId]
        );
        const espera = Date.now() - inicio;
        if (subasta.estado !== 'Activa' || Number(monto) <= Number(subasta.precio_actual)) {
            await client.query('ROLLBACK');
            return { aceptada: false, espera, precioVisto: subasta.precio_actual };
        }
        if (retenerMs) await esperar(retenerMs);   // simula trabajo con la fila bloqueada
        await client.query('UPDATE subastas SET precio_actual = $1 WHERE subasta_id = $2', [monto, subastaId]);
        const { rows: [puja] } = await client.query(
            'INSERT INTO pujas (subasta_id, emprendedor_id, monto_puja) VALUES ($1, $2, $3) RETURNING puja_id',
            [subastaId, emprendedorId, monto]
        );
        await client.query('COMMIT');
        return { aceptada: true, espera, pujaId: puja.puja_id };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    } finally {
        client.release();
    }
}

async function main() {
    const ids = { usuarios: [], departamento: null };
    try {
        // 1. Conexión
        let t = Date.now();
        const { rows: [info] } = await pool.query(
            `SELECT current_database() AS db, current_setting('server_version') AS version, now() AS ahora`
        );
        ok(true, 'Conexión a Neon por el pooler', `base ${info.db}, Postgres ${info.version}, ${Date.now() - t} ms`);

        // 2. Esquema
        const { rows: [tablas] } = await pool.query(
            `SELECT count(*)::int AS total FROM information_schema.tables
             WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
        );
        ok(tablas.total === 18, 'Esquema con 18 tablas', `${tablas.total} encontradas`);

        // 3. Datos de prueba con RETURNING
        const { rows: [depto] } = await pool.query(
            'INSERT INTO departamentos (nombre_departamento) VALUES ($1) RETURNING departamento_id', [marca.slice(0, 50)]
        );
        ids.departamento = depto.departamento_id;
        const crearUsuario = async (rol, nombre) => {
            const { rows: [u] } = await pool.query(
                `INSERT INTO usuarios (correo_electronico, contrasena_hash, tipo_rol)
                 VALUES ($1, 'hash-de-prueba', $2) RETURNING usuario_id`,
                [`${rol.toLowerCase()}-${ids.usuarios.length}-${marca}@ejemplo.test`, rol]
            );
            ids.usuarios.push(u.usuario_id);
            await pool.query(
                `INSERT INTO perfiles_usuarios (usuario_id, nombre_razon_social, telefono_whatsapp, departamento_id)
                 VALUES ($1, $2, '88888888', $3)`, [u.usuario_id, nombre, ids.departamento]
            );
            return u.usuario_id;
        };
        const proveedor = await crearUsuario('Proveedor', 'Curtiembre de Prueba');
        const ana = await crearUsuario('Emprendedor', 'Calzado Ana');
        const luis = await crearUsuario('Emprendedor', 'Talabartería Luis');

        const { rows: [oferta] } = await pool.query(
            `INSERT INTO ofertas (proveedor_id, titulo_material, categoria_id, precio, unidad_medida, distancia_simulada_km)
             VALUES ($1, 'Cuero café de prueba', 1, 500, 'pie²', 10) RETURNING oferta_id, precio`, [proveedor]
        );
        const { rows: [subasta] } = await pool.query(
            `INSERT INTO subastas (proveedor_id, oferta_id, categoria_id, titulo_lote, precio_base, precio_actual, fecha_fin)
             VALUES ($1, $2, 1, 'Lote de prueba', 500, 500, now() + interval '7 days') RETURNING subasta_id`,
            [proveedor, oferta.oferta_id]
        );
        ok(Number.isInteger(subasta.subasta_id) && oferta.precio === '500.00',
            'INSERT ... RETURNING devuelve los IDs', `oferta ${oferta.oferta_id}, subasta ${subasta.subasta_id}; numeric llega como texto "${oferta.precio}"`);

        // 4. Pujas simultáneas: Ana puja 600 y retiene la fila 800 ms; Luis puja 550 a los 100 ms
        const pujaAna = pujar(subasta.subasta_id, ana, 600, 800);
        await esperar(100);
        const pujaLuis = pujar(subasta.subasta_id, luis, 550);
        const [rAna, rLuis] = await Promise.all([pujaAna, pujaLuis]);
        const { rows: [final] } = await pool.query(
            `SELECT s.precio_actual, (SELECT count(*)::int FROM pujas p WHERE p.subasta_id = s.subasta_id) AS pujas
             FROM subastas s WHERE s.subasta_id = $1`, [subasta.subasta_id]
        );
        ok(rAna.aceptada, 'Puja de 600 aceptada');
        ok(!rLuis.aceptada && rLuis.espera >= 500,
            'Puja simultánea de 550 esperó el bloqueo y fue rechazada',
            `esperó ${rLuis.espera} ms y vio precio ${rLuis.precioVisto}`);
        ok(final.precio_actual === '600.00' && final.pujas === 1,
            'Precio final correcto, sin pujas perdidas', `precio ${final.precio_actual}, ${final.pujas} puja`);

        // 5. Búsqueda sin acentos ni mayúsculas
        const { rows: encontrados } = await pool.query(
            `SELECT nombre_categoria FROM categorias_materiales
             WHERE unaccent(nombre_categoria) ILIKE unaccent($1)`, ['%LATEX%']
        );
        const { rows: sinUnaccent } = await pool.query(
            `SELECT 1 FROM categorias_materiales WHERE nombre_categoria LIKE $1`, ['%latex%']
        );
        ok(encontrados.length === 1 && sinUnaccent.length === 0,
            'Buscar "LATEX" encuentra "Látex" con unaccent + ILIKE',
            `"${encontrados[0]?.nombre_categoria}"; con LIKE simple: ${sinUnaccent.length} resultados`);

        // 6. COUNT(*)
        const { rows: [conteo] } = await pool.query(
            'SELECT count(*) AS texto, count(*)::int AS numero FROM categorias_materiales'
        );
        ok(typeof conteo.texto === 'string' && typeof conteo.numero === 'number',
            'COUNT(*) llega como texto; con ::int como número', `${JSON.stringify(conteo.texto)} vs ${conteo.numero}`);

        // 7. Trigger de fecha_actualizacion
        const { rows: [v1] } = await pool.query(
            `INSERT INTO verificaciones_antifraude (usuario_id, fecha_actualizacion)
             VALUES ($1, now() - interval '1 day') RETURNING fecha_actualizacion`, [proveedor]
        );
        const { rows: [v2] } = await pool.query(
            `UPDATE verificaciones_antifraude SET estado_final = 'Verificado' WHERE usuario_id = $1
             RETURNING fecha_actualizacion`, [proveedor]
        );
        ok(v2.fecha_actualizacion > v1.fecha_actualizacion, 'Trigger actualiza fecha_actualizacion al modificar');
    } finally {
        // Limpieza: subastas (y sus pujas) -> ofertas -> usuarios (perfiles y verificaciones en cascada) -> departamento
        if (ids.usuarios.length) {
            await pool.query('DELETE FROM subastas WHERE proveedor_id = ANY($1)', [ids.usuarios]);
            await pool.query('DELETE FROM ofertas WHERE proveedor_id = ANY($1)', [ids.usuarios]);
            await pool.query('DELETE FROM usuarios WHERE usuario_id = ANY($1)', [ids.usuarios]);
        }
        if (ids.departamento) await pool.query('DELETE FROM departamentos WHERE departamento_id = $1', [ids.departamento]);
        const { rows: [resto] } = await pool.query(
            `SELECT count(*)::int AS n FROM usuarios WHERE correo_electronico LIKE $1`, [`%${marca}%`]
        );
        ok(resto.n === 0, 'Datos de prueba borrados');
        await pool.end();
    }
}

main()
    .then(() => {
        console.log(fallos ? `\n❌ ${fallos} comprobación(es) fallaron.` : '\n✅ Neon funciona de punta a punta.');
        process.exit(fallos ? 1 : 0);
    })
    .catch((err) => {
        console.error('\n❌ Error inesperado:', err.message);
        process.exit(1);
    });
