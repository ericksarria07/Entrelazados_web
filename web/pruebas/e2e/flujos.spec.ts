// ==========================================================================
// LOS 4 FLUJOS CLAVE DE ENTRELAZADOS, DE PUNTA A PUNTA (ROADMAP 2.8)
//   1. El proveedor publica una oferta (se abre su subasta de 7 días).
//   2. Dos emprendedores pujan; el segundo supera al primero.
//   3. La subasta cierra: el ganador ve el trato, el proveedor lo completa,
//      el ganador califica y abre el comprobante.
//   4. Comprador y proveedor se escriben por el chat.
// Cada persona usa su propio navegador (contexto) con su cookie de sesión.
// ==========================================================================
import { expect, test, type Browser, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import pg from "pg";

const CLAVE = "E2e-Clave123";
// Con SSL (Neon) se verifica el certificado, igual que pruebas/api/contexto.mjs
const url = (process.env.PRUEBAS_DATABASE_URL ?? "").replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
const pool = new pg.Pool({ connectionString: url, max: 2 });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as T[];

type Cuenta = { id: number; email: string; nombre: string };

async function crearCuenta(rol: "Proveedor" | "Emprendedor", nombre: string, depto: number): Promise<Cuenta> {
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
async function entrar(browser: Browser, cuenta: Cuenta | { email: string; clave: string }): Promise<Page> {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  pagina.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Todo excelente" : undefined));
  await pagina.goto("/login");
  await pagina.fill("#login-email", cuenta.email);
  await pagina.fill("#login-password", "clave" in cuenta ? cuenta.clave : CLAVE);
  await Promise.all([pagina.waitForURL(/\/(inicio|admin)(\?|$)/), pagina.click("#btn-submit-login")]);
  return pagina;
}

let proveedor: Cuenta, comprador1: Cuenta, comprador2: Cuenta;
let pProveedor: Page, pComprador1: Page, pComprador2: Page;
let subastaId = 0;
const TITULO = "Cuero vacuno E2E";

test.describe.serial("Flujos clave", () => {
  test.beforeAll(async ({ browser }) => {
    proveedor = await crearCuenta("Proveedor", "Curtiembre E2E", 2);
    comprador1 = await crearCuenta("Emprendedor", "Zapateria Uno E2E", 1);
    comprador2 = await crearCuenta("Emprendedor", "Zapateria Dos E2E", 3);
    pProveedor = await entrar(browser, proveedor);
    pComprador1 = await entrar(browser, comprador1);
    pComprador2 = await entrar(browser, comprador2);
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("1. El proveedor publica una oferta y se abre su subasta", async () => {
    const p = pProveedor;
    await p.goto("/mercado");
    await p.click("#btn-publicar-modal");
    await expect(p.locator("#modalOferta")).toBeVisible();
    await p.fill("#ofertaTitulo", TITULO);
    await p.fill("#ofertaDescripcion", "Curtido al vegetal, 1.8 mm, color café.");
    await p.fill("#ofertaPrecio", "500");
    await p.fill("#ofertaUnidad", "por pie²");
    await p.fill("#ofertaDistancia", "12");
    await p.selectOption("#ofertaCategoria", { index: 1 });
    await p.click("#btnGuardarOferta");
    await expect(p.locator("#modalOferta")).toBeHidden({ timeout: 20_000 });
    await expect(p.locator("#contenedor-ofertas")).toContainText(TITULO);

    const [s] = await q<{ subasta_id: number }>(
      `SELECT s.subasta_id FROM subastas s JOIN ofertas o ON o.oferta_id = s.oferta_id WHERE o.titulo_material = $1`,
      [TITULO]
    );
    expect(s, "la oferta abre su subasta").toBeTruthy();
    subastaId = s.subasta_id;
  });

  test("2. Dos emprendedores pujan y el segundo supera al primero", async () => {
    for (const [p, monto] of [
      [pComprador1, 550],
      [pComprador2, 600],
    ] as const) {
      await p.goto("/mercado#tab-auctions");
      const campo = p.locator(`#subasta-input-${subastaId}`);
      await expect(campo).toBeVisible();
      await campo.fill(String(monto));
      await p.locator(`.auction-card:has(#subasta-input-${subastaId}) button.cta`).click();
      await expect(p.locator(`#subasta-val-${subastaId}`)).toContainText(String(monto));
    }
    // Una puja que no supera la actual se rechaza sin llegar al servidor
    const p = pComprador1;
    await p.goto("/mercado#tab-auctions");
    const mensaje = p.waitForEvent("dialog");
    await p.locator(`#subasta-input-${subastaId}`).fill("580");
    await p.locator(`.auction-card:has(#subasta-input-${subastaId}) button.cta`).click();
    expect((await mensaje).message()).toContain("mayor al precio actual");
    // El proveedor no puede pujar en su propio lote
    await pProveedor.goto("/mercado#tab-auctions");
    await expect(pProveedor.locator(`#subasta-input-${subastaId}`)).toBeDisabled();
  });

  test("3. Cierra la subasta: trato, entrega completada, calificación y comprobante", async ({ browser }) => {
    // Se vence la subasta y el admin la cierra (lo mismo que hace el cron)
    await q(`UPDATE subastas SET fecha_fin = now() - interval '1 minute' WHERE subasta_id = $1`, [subastaId]);
    const admin = await entrar(browser, { email: "admin@prueba.com", clave: "Admin123!" });
    const cierre = await admin.evaluate(async () => (await fetch("/api/admin/subastas/cerrar-vencidas", { method: "POST" })).status);
    expect(cierre).toBe(200);

    // El ganador ve el trato en su dashboard
    await pComprador2.goto("/dashboard");
    const trato = pComprador2.locator("[data-trato]").first();
    await expect(trato).toContainText(TITULO);
    await expect(trato).toContainText("Pendiente");

    // El proveedor lo marca como completado
    await pProveedor.goto("/dashboard");
    await pProveedor.locator('.trato-acciones button:has-text("Completado")').first().click();
    await expect(pProveedor.locator("[data-trato]").first()).toContainText("Completado");

    // El ganador califica con 5 estrellas
    await pComprador2.reload();
    await pComprador2.locator(".trato-estrellas .estrella").first().click();
    await expect(pComprador2.locator(".trato-calificacion").first()).toContainText("Tu calificación");
    const [c] = await q<{ puntuacion: number }>(
      `SELECT c.puntuacion FROM calificaciones c JOIN tratos_cerrados t ON t.trato_id = c.trato_id WHERE t.origen_id = $1`,
      [subastaId]
    );
    expect(c?.puntuacion).toBe(5);

    // Comprobante para imprimir
    const [t] = await q<{ trato_id: number }>(`SELECT trato_id FROM tratos_cerrados WHERE origen_id = $1`, [subastaId]);
    await pComprador2.goto(`/comprobante?trato=${t.trato_id}`);
    await expect(pComprador2.locator("body")).toContainText(/EL-\d+/);
    await expect(pComprador2.locator("body")).toContainText("600");
  });

  test("4. Comprador y proveedor se escriben por el chat", async () => {
    const texto = "¿Tienen el mismo cuero en negro?";
    await pComprador1.goto(`/chat?contacto=${proveedor.id}`);
    await expect(pComprador1.locator("#chat-vendor-name")).toContainText(proveedor.nombre);
    await pComprador1.fill("#chat-text", texto);
    await pComprador1.click(".chat-send");
    await expect(pComprador1.locator("#chat-msgs")).toContainText(texto);

    // Al proveedor le aparece (sin tiempo real, la conversación se consulta cada 2 s)
    await pProveedor.goto(`/chat?contacto=${comprador1.id}`);
    await expect(pProveedor.locator("#chat-msgs")).toContainText(texto, { timeout: 15_000 });
    await pProveedor.fill("#chat-text", "Sí, también en negro.");
    await pProveedor.click(".chat-send");
    await expect(pComprador1.locator("#chat-msgs")).toContainText("también en negro", { timeout: 15_000 });
  });
});
