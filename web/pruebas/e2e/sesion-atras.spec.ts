// ==========================================================================
// BOTÓN ATRÁS DESPUÉS DE CAMBIAR DE CUENTA
// En producción (Vercel) las páginas llegan con "public, max-age=0, must-revalidate" y el
// navegador puede guardarlas enteras en memoria (bfcache): al regresar mostraba la página
// tal como estaba, con la sesión de la cuenta anterior. ProveedorSitio escucha "pageshow"
// con persisted = true y, si la sesión cambió, recarga.
// Los navegadores que controla Playwright no restauran páginas de la bfcache, así que la
// prueba dispara el mismo evento que el navegador al restaurar la página.
// ==========================================================================
import { expect, test, type Page } from "@playwright/test";
import { type Cuenta, CLAVE, cerrarBase, crearCuenta, entrar } from "./ayudas";

let alfa: Cuenta;
let beta: Cuenta;

// Lo que hace el navegador al mostrar una página guardada en la bfcache
const restaurarDeLaMemoria = (pagina: Page) =>
  pagina.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
const nombreEnElMenu = (pagina: Page) => pagina.locator(".user-nav-name").first();

test.describe.serial("Botón Atrás tras cambiar de cuenta", () => {
  test.beforeAll(async () => {
    alfa = await crearCuenta("Emprendedor", "Cuenta Alfa Atras", 1);
    beta = await crearCuenta("Emprendedor", "Cuenta Beta Atras", 1);
  });
  test.afterAll(cerrarBase);

  test("si entró otra cuenta, la página restaurada se recarga con la sesión nueva", async ({ browser }) => {
    const pagina = await entrar(browser, alfa);
    await expect(nombreEnElMenu(pagina)).toHaveText(alfa.nombre);

    // Otra pestaña del mismo navegador cierra la sesión y entra con la otra cuenta
    await pagina.context().request.post("/api/logout"); // comparte las cookies del navegador
    const otra = await pagina.context().newPage();
    await otra.goto("/login");
    await otra.evaluate(() => localStorage.clear()); // lo que hace cerrarSesion()
    await otra.fill("#login-email", beta.email);
    await otra.fill("#login-password", CLAVE);
    await Promise.all([otra.waitForURL(/\/inicio/), otra.click("#btn-submit-login")]);

    await pagina.bringToFront();
    await Promise.all([pagina.waitForEvent("load"), restaurarDeLaMemoria(pagina)]);
    await expect(nombreEnElMenu(pagina)).toHaveText(beta.nombre);
    await pagina.context().close();
  });

  test("si se cerró la sesión, la página restaurada manda a /login", async ({ browser }) => {
    const pagina = await entrar(browser, alfa);
    await pagina.context().request.post("/api/logout");
    await pagina.evaluate(() => localStorage.removeItem("userId"));
    await Promise.all([pagina.waitForURL(/\/login/), restaurarDeLaMemoria(pagina)]);
    await pagina.context().close();
  });

  test("con la misma sesión no recarga", async ({ browser }) => {
    const pagina = await entrar(browser, alfa);
    await pagina.evaluate(() => ((window as unknown as { marca: number }).marca = 1));
    await restaurarDeLaMemoria(pagina);
    await pagina.waitForTimeout(1500); // da tiempo a la consulta a /api/sesion
    expect(await pagina.evaluate(() => (window as unknown as { marca?: number }).marca)).toBe(1);
    await expect(nombreEnElMenu(pagina)).toHaveText(alfa.nombre);
    await pagina.context().close();
  });
});
