// Ayudas compartidas por las pruebas E2E: crear cuentas directo en la base de pruebas
// e iniciar sesión por el formulario, cada persona en su propio navegador (contexto).
import type { Browser, Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import pg from "pg";

export const CLAVE = "E2e-Clave123";
// Con SSL (Neon) se verifica el certificado, igual que pruebas/api/contexto.mjs
const url = (process.env.PRUEBAS_DATABASE_URL ?? "").replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
// La conexión se abre al usarla y se puede cerrar y volver a abrir: varios archivos de
// pruebas comparten este módulo y cada uno cierra la suya al terminar
let pool: pg.Pool | null = null;
export const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => {
  pool ??= new pg.Pool({ connectionString: url, max: 2 });
  return (await pool.query(sql, p)).rows as T[];
};
export async function cerrarBase() {
  const abierta = pool;
  pool = null;
  await abierta?.end();
}

export type Cuenta = { id: number; email: string; nombre: string };

export async function crearCuenta(rol: "Proveedor" | "Emprendedor", nombre: string, depto: number): Promise<Cuenta> {
  const email = `${nombre.toLowerCase().replace(/\s+/g, ".")}@e2e.example.com`;
  const [{ usuario_id: id }] = await q<{ usuario_id: number }>(
    `INSERT INTO usuarios (correo_electronico, contrasena_hash, tipo_rol, estado_cuenta, correo_verificado)
     VALUES ($1, $2, $3, 'Activo', true) RETURNING usuario_id`,
    [email, bcrypt.hashSync(CLAVE, 10), rol]
  );
  await q(`INSERT INTO perfiles_usuarios (usuario_id, nombre_razon_social, telefono_whatsapp, departamento_id) VALUES ($1, $2, '88880000', $3)`, [
    id,
    nombre,
    depto,
  ]);
  if (rol === "Proveedor") await q(`INSERT INTO proveedores (usuario_id, nombre_comercial) VALUES ($1, $2)`, [id, nombre]);
  else await q(`INSERT INTO emprendedores (usuario_id, nombre_marca) VALUES ($1, $2)`, [id, nombre]);
  return { id, email, nombre };
}

// Abre un navegador nuevo, inicia sesión por el formulario y devuelve la página
export async function entrar(browser: Browser, cuenta: Cuenta | { email: string; clave: string }): Promise<Page> {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  pagina.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Todo excelente" : undefined));
  await pagina.goto("/login");
  await pagina.fill("#login-email", cuenta.email);
  await pagina.fill("#login-password", "clave" in cuenta ? cuenta.clave : CLAVE);
  await Promise.all([pagina.waitForURL(/\/(inicio|admin)(\?|$)/), pagina.click("#btn-submit-login")]);
  return pagina;
}
