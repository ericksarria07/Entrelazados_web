// ==========================================================================
// CREAR UNA CUENTA DE ADMINISTRADOR
//
//   cd web && npm run admin:crear
//
// Registrarse como administrador está prohibido en /registro (a propósito), así
// que la cuenta se crea aquí. Pide el correo, el nombre y la contraseña en la
// terminal (la contraseña no se muestra) y la guarda en la base de DATABASE_URL
// (web/.env.local; con neon env pull es producción).
// Si el correo ya existe, ofrece convertir esa cuenta en administrador.
// ==========================================================================
import { stdin, stdout } from "node:process";
import readline from "node:readline";
import bcrypt from "bcryptjs";
import pg from "pg";

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RONDAS_BCRYPT = 10;

const url = (process.env.DATABASE_URL ?? "").trim();
if (!url) {
  console.error('❌ Falta DATABASE_URL. Corre "neon env pull" dentro de web/ (lo escribe en .env.local).');
  process.exit(1);
}

const rl = readline.createInterface({ input: stdin, output: stdout, terminal: Boolean(stdin.isTTY) });

// Cola de líneas: sirve igual en la terminal y con la entrada redirigida (pruebas)
const lineas: string[] = [];
const esperando: ((linea: string | null) => void)[] = [];
let cerrado = false;
rl.on("line", (l) => (esperando.length ? esperando.shift()!(l) : lineas.push(l)));
rl.on("close", () => {
  cerrado = true;
  while (esperando.length) esperando.shift()!(null);
});

const salida = rl as unknown as { _writeToOutput: (s: string) => void };
const escribirNormal = salida._writeToOutput?.bind(rl);

// oculto: lo que se escribe no aparece en pantalla (para la contraseña)
async function preguntar(texto: string, oculto = false): Promise<string> {
  stdout.write(texto);
  if (oculto && stdin.isTTY) salida._writeToOutput = (t: string) => (t.includes("\n") || t.includes("\r") ? stdout.write("\n") : undefined);
  try {
    const linea = lineas.length ? lineas.shift()! : cerrado ? null : await new Promise<string | null>((r) => esperando.push(r));
    if (linea === null) throw new Error("Se cerró la entrada antes de terminar.");
    if (!stdin.isTTY) stdout.write("\n");
    return linea;
  } finally {
    if (oculto && stdin.isTTY && escribirNormal) salida._writeToOutput = escribirNormal;
  }
}

async function main() {
  const host = new URL(url).hostname;
  console.log(`Base de datos: ${host}\n`);

  const correo = (await preguntar("Correo del administrador: ")).trim();
  if (!REGEX_EMAIL.test(correo)) throw new Error("El correo no es válido (ejemplo: usuario@gmail.com).");

  const pool = new pg.Pool({ connectionString: url.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full"), max: 2 });
  try {
    const {
      rows: [existente],
    } = await pool.query("SELECT usuario_id, tipo_rol FROM usuarios WHERE lower(correo_electronico) = lower($1)", [correo]);

    if (existente) {
      if (/^admin/i.test(existente.tipo_rol)) {
        console.log("ℹ️  Esa cuenta ya es de administrador. No se cambió nada.");
        return;
      }
      const respuesta = (await preguntar(`Esa cuenta ya existe (${existente.tipo_rol}). ¿Convertirla en administrador? (s/N): `)).trim().toLowerCase();
      if (respuesta !== "s" && respuesta !== "si" && respuesta !== "sí") {
        console.log("No se cambió nada.");
        return;
      }
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("UPDATE usuarios SET tipo_rol = 'Administrador', estado_cuenta = 'Activo', correo_verificado = true WHERE usuario_id = $1", [
          existente.usuario_id,
        ]);
        await c.query(
          "INSERT INTO administradores (usuario_id) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM administradores WHERE usuario_id = $1)",
          [existente.usuario_id]
        );
        await c.query("COMMIT");
      } catch (err) {
        await c.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        c.release();
      }
      console.log("✅ La cuenta ahora es de administrador. Inicia sesión con su contraseña de siempre.");
      return;
    }

    const nombre = (await preguntar("Nombre que se mostrará (ej. Administración EntreLazados): ")).trim() || "Administrador";
    const clave = await preguntar("Contraseña (mínimo 8 caracteres): ", true);
    if (clave.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
    if (Buffer.byteLength(clave, "utf8") > 72) throw new Error("La contraseña es demasiado larga (máximo 72 caracteres).");
    const repetida = await preguntar("Repite la contraseña: ", true);
    if (repetida !== clave) throw new Error("Las contraseñas no coinciden.");

    const hash = await bcrypt.hash(clave, RONDAS_BCRYPT);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const {
        rows: [depto],
      } = await c.query(
        `INSERT INTO departamentos (nombre_departamento) VALUES ('Managua')
         ON CONFLICT (nombre_departamento) DO UPDATE SET nombre_departamento = EXCLUDED.nombre_departamento
         RETURNING departamento_id`
      );
      const {
        rows: [u],
      } = await c.query(
        `INSERT INTO usuarios (correo_electronico, contrasena_hash, tipo_rol, estado_cuenta, correo_verificado)
         VALUES ($1, $2, 'Administrador', 'Activo', true) RETURNING usuario_id`,
        [correo, hash]
      );
      await c.query(
        "INSERT INTO perfiles_usuarios (usuario_id, nombre_razon_social, telefono_whatsapp, departamento_id) VALUES ($1, $2, '', $3)",
        [u.usuario_id, nombre, depto.departamento_id]
      );
      await c.query("INSERT INTO administradores (usuario_id) VALUES ($1)", [u.usuario_id]);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
    console.log(`\n✅ Administrador creado: ${correo}. Ya puedes iniciar sesión en login.html y abrir admin.html.`);
  } finally {
    await pool.end();
  }
}

main()
  .catch((err) => {
    console.error(`\n❌ ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
