// ==========================================================================
// PRUEBA DE PUNTA A PUNTA DE NEON (con el esquema de Drizzle)
//
//   npm run probar:neon        (lee DATABASE_URL de .env.local)
//
// Usa la conexión con pooler, la misma que usa la app, y comprueba lo que la
// migración necesita de Postgres:
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
import { eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as t from "../db/esquema.ts";

const url = (process.env.DATABASE_URL ?? "").trim();
if (!url) {
  console.error('❌ Falta DATABASE_URL. Corre "neon env pull" dentro de web/ (lo escribe en .env.local).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: url.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full"),
  max: 5,
});
const db = drizzle({ client: pool, schema: t, casing: "snake_case" });

const marca = `prueba-neon-${Date.now()}`;
let fallos = 0;

function ok(condicion: boolean, texto: string, detalle = "") {
  if (!condicion) fallos++;
  console.log(`${condicion ? "✔" : "✖"} ${texto}${detalle ? `  (${detalle})` : ""}`);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Puja como la hará la app: bloquea la fila de la subasta, valida y actualiza
async function pujar(subastaId: number, emprendedorId: number, monto: number, retenerMs = 0) {
  const inicio = Date.now();
  return db.transaction(async (tx) => {
    const [subasta] = await tx
      .select({ precioActual: t.subastas.precioActual, estado: t.subastas.estado })
      .from(t.subastas)
      .where(eq(t.subastas.subastaId, subastaId))
      .for("update");
    const espera = Date.now() - inicio;
    if (subasta.estado !== "Activa" || monto <= Number(subasta.precioActual)) {
      return { aceptada: false, espera, precioVisto: subasta.precioActual };
    }
    if (retenerMs) await esperar(retenerMs); // simula trabajo con la fila bloqueada
    await tx.update(t.subastas).set({ precioActual: String(monto) }).where(eq(t.subastas.subastaId, subastaId));
    const [puja] = await tx
      .insert(t.pujas)
      .values({ subastaId, emprendedorId, montoPuja: String(monto) })
      .returning({ pujaId: t.pujas.pujaId });
    return { aceptada: true, espera, pujaId: puja.pujaId };
  });
}

async function main() {
  const ids: { usuarios: number[]; departamento: number | null } = { usuarios: [], departamento: null };
  try {
    // 1. Conexión
    const t0 = Date.now();
    const {
      rows: [info],
    } = await pool.query(`SELECT current_database() AS db, current_setting('server_version') AS version`);
    ok(true, "Conexión a Neon por el pooler", `base ${info.db}, Postgres ${info.version}, ${Date.now() - t0} ms`);

    // 2. Esquema
    const {
      rows: [tablas],
    } = await pool.query(
      `SELECT count(*)::int AS total FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    ok(tablas.total === 18, "Esquema con 18 tablas", `${tablas.total} encontradas`);

    // 3. Datos de prueba con RETURNING
    const [depto] = await db
      .insert(t.departamentos)
      .values({ nombreDepartamento: marca.slice(0, 50) })
      .returning({ id: t.departamentos.departamentoId });
    ids.departamento = depto.id;

    const crearUsuario = async (rol: string, nombre: string) => {
      const [u] = await db
        .insert(t.usuarios)
        .values({
          correoElectronico: `${rol.toLowerCase()}-${ids.usuarios.length}-${marca}@ejemplo.test`,
          contrasenaHash: "hash-de-prueba",
          tipoRol: rol,
        })
        .returning({ id: t.usuarios.usuarioId });
      ids.usuarios.push(u.id);
      await db.insert(t.perfilesUsuarios).values({
        usuarioId: u.id,
        nombreRazonSocial: nombre,
        telefonoWhatsapp: "88888888",
        departamentoId: depto.id,
      });
      return u.id;
    };
    const proveedor = await crearUsuario("Proveedor", "Curtiembre de Prueba");
    const ana = await crearUsuario("Emprendedor", "Calzado Ana");
    const luis = await crearUsuario("Emprendedor", "Talabartería Luis");

    const [oferta] = await db
      .insert(t.ofertas)
      .values({
        proveedorId: proveedor,
        tituloMaterial: "Cuero café de prueba",
        categoriaId: 1,
        precio: "500",
        unidadMedida: "pie²",
        distanciaSimuladaKm: 10,
      })
      .returning({ id: t.ofertas.ofertaId, precio: t.ofertas.precio });
    const [subasta] = await db
      .insert(t.subastas)
      .values({
        proveedorId: proveedor,
        ofertaId: oferta.id,
        categoriaId: 1,
        tituloLote: "Lote de prueba",
        precioBase: "500",
        precioActual: "500",
        fechaFin: sql`now() + interval '7 days'`,
      })
      .returning({ id: t.subastas.subastaId });
    ok(
      Number.isInteger(subasta.id) && oferta.precio === "500.00",
      "INSERT ... RETURNING devuelve los IDs",
      `oferta ${oferta.id}, subasta ${subasta.id}; numeric llega como texto "${oferta.precio}"`
    );

    // 4. Pujas simultáneas: Ana puja 600 y retiene la fila 800 ms; Luis puja 550 a los 100 ms
    const pujaAna = pujar(subasta.id, ana, 600, 800);
    await esperar(100);
    const pujaLuis = pujar(subasta.id, luis, 550);
    const [rAna, rLuis] = await Promise.all([pujaAna, pujaLuis]);
    const [final] = await db
      .select({
        precioActual: t.subastas.precioActual,
        pujas: sql<number>`(SELECT count(*)::int FROM ${t.pujas} WHERE ${t.pujas.subastaId} = ${t.subastas.subastaId})`,
      })
      .from(t.subastas)
      .where(eq(t.subastas.subastaId, subasta.id));
    ok(rAna.aceptada, "Puja de 600 aceptada");
    ok(
      !rLuis.aceptada && rLuis.espera >= 500,
      "Puja simultánea de 550 esperó el bloqueo y fue rechazada",
      `esperó ${rLuis.espera} ms y vio precio ${rLuis.precioVisto}`
    );
    ok(
      final.precioActual === "600.00" && final.pujas === 1,
      "Precio final correcto, sin pujas perdidas",
      `precio ${final.precioActual}, ${final.pujas} puja`
    );

    // 5. Búsqueda sin acentos ni mayúsculas
    const encontrados = await db
      .select({ nombre: t.categoriasMateriales.nombreCategoria })
      .from(t.categoriasMateriales)
      .where(sql`unaccent(${t.categoriasMateriales.nombreCategoria}) ILIKE unaccent(${"%LATEX%"})`);
    const sinUnaccent = await db
      .select({ uno: sql`1` })
      .from(t.categoriasMateriales)
      .where(like(t.categoriasMateriales.nombreCategoria, "%latex%"));
    ok(
      encontrados.length === 1 && sinUnaccent.length === 0,
      'Buscar "LATEX" encuentra "Látex" con unaccent + ILIKE',
      `"${encontrados[0]?.nombre}"; con LIKE simple: ${sinUnaccent.length} resultados`
    );

    // 6. COUNT(*)
    const {
      rows: [conteo],
    } = await pool.query("SELECT count(*) AS texto, count(*)::int AS numero FROM categorias_materiales");
    ok(
      typeof conteo.texto === "string" && typeof conteo.numero === "number",
      "COUNT(*) llega como texto; con ::int como número",
      `${JSON.stringify(conteo.texto)} vs ${conteo.numero}`
    );

    // 7. Trigger de fecha_actualizacion
    const [v1] = await db
      .insert(t.verificacionesAntifraude)
      .values({ usuarioId: proveedor, fechaActualizacion: sql`now() - interval '1 day'` })
      .returning({ fecha: t.verificacionesAntifraude.fechaActualizacion });
    const [v2] = await db
      .update(t.verificacionesAntifraude)
      .set({ estadoFinal: "Verificado" })
      .where(eq(t.verificacionesAntifraude.usuarioId, proveedor))
      .returning({ fecha: t.verificacionesAntifraude.fechaActualizacion });
    ok(v2.fecha! > v1.fecha!, "Trigger actualiza fecha_actualizacion al modificar");
  } finally {
    // Limpieza: subastas (y sus pujas) -> ofertas -> usuarios (perfiles y verificaciones en cascada) -> departamento
    if (ids.usuarios.length) {
      await db.delete(t.subastas).where(inArray(t.subastas.proveedorId, ids.usuarios));
      await db.delete(t.ofertas).where(inArray(t.ofertas.proveedorId, ids.usuarios));
      await db.delete(t.usuarios).where(inArray(t.usuarios.usuarioId, ids.usuarios));
    }
    if (ids.departamento) {
      await db.delete(t.departamentos).where(eq(t.departamentos.departamentoId, ids.departamento));
    }
    const [resto] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.usuarios)
      .where(like(t.usuarios.correoElectronico, `%${marca}%`));
    ok(resto.n === 0, "Datos de prueba borrados");
    await pool.end();
  }
}

main()
  .then(() => {
    console.log(fallos ? `\n❌ ${fallos} comprobación(es) fallaron.` : "\n✅ Neon funciona de punta a punta.");
    process.exit(fallos ? 1 : 0);
  })
  .catch((err) => {
    console.error("\n❌ Error inesperado:", err.message);
    process.exit(1);
  });
