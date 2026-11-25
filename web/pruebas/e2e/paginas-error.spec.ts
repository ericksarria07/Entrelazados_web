// ==========================================================================
// PÁGINA 404 (app/not-found.tsx)
// Una dirección que no existe responde 404 con el aviso en español, sin indexar,
// y el botón lleva a la portada. Los errores (app/error.tsx, global-error.tsx) no se
// pueden provocar desde fuera sin romper una página a propósito.
// ==========================================================================
import { expect, test } from "@playwright/test";

test("una dirección que no existe muestra la página 404 en español", async ({ page }) => {
  const respuesta = await page.goto("/esta-pagina-no-existe");
  expect(respuesta?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
  await expect(page).toHaveTitle("Página no encontrada - EntreLazados");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await page.locator("#btn-portada").click();
  await expect(page).toHaveURL(/\/$/);
});
