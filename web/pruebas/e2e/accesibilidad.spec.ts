// ==========================================================================
// ACCESIBILIDAD AUTOMÁTICA CON AXE (WCAG 2.1 A y AA)
// Revisa las páginas públicas y las de sesión en tamaño de celular, en modo claro y oscuro.
// Falla con las infracciones "critical" y "serious" (contraste, etiquetas, nombres de
// botones...). Las "moderate" y "minor" se listan en la consola sin fallar.
// ==========================================================================
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { type Cuenta, cerrarBase, crearCuenta, entrar } from "./ayudas";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function revisar(pagina: Page, nombre: string) {
  // Espera a que la página pinte su contenido. No sirve "networkidle": el chat consulta
  // mensajes cada 2 s y la red nunca queda quieta.
  await pagina.waitForLoadState("load");
  await pagina.locator("#contenido-principal").first().waitFor({ timeout: 15_000 }).catch(() => {});
  await pagina.waitForTimeout(700);
  const { violations } = await new AxeBuilder({ page: pagina }).withTags(ETIQUETAS).analyze();
  const graves = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const menores = violations.filter((v) => !graves.includes(v));
  for (const v of menores) console.log(`  [${nombre}] ${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}`);
  const detalle = graves
    .map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.slice(0, 4).map((n) => `    ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1] ?? ""}`).join("\n")}`)
    .join("\n");
  // soft: sigue con las demás páginas y al final muestra todo lo que encontró
  expect.soft(graves.length, `${nombre}:\n${detalle}`).toBe(0);
}

let cuenta: Cuenta;

test.describe.serial("Accesibilidad (axe)", () => {
  // Cada prueba revisa cinco páginas con axe
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    cuenta = await crearCuenta("Proveedor", "Curtiembre Accesible", 1);
  });

  test.afterAll(async () => {
    await cerrarBase();
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`páginas públicas (modo ${tema})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("entrelazados-tema", t), tema);
      for (const ruta of ["/", "/login", "/unirse", "/restablecer", `/perfil-publico?id=${cuenta.id}`]) {
        await page.goto(ruta);
        await revisar(page, `${ruta} (${tema})`);
      }
    });

    test(`páginas con sesión (modo ${tema})`, async ({ browser }) => {
      const page = await entrar(browser, cuenta);
      await page.evaluate((t) => localStorage.setItem("entrelazados-tema", t), tema);
      for (const ruta of ["/inicio", "/mercado", "/perfil", "/dashboard", "/chat"]) {
        await page.goto(ruta);
        await revisar(page, `${ruta} (${tema})`);
      }
      await page.context().close();
    });
  }
});
